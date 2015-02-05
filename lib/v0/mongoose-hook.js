'use strict';

var hooks = {};

// async hook injector for mongoose database API wrappers
function hookAsync(namespace, methodName, hookFunction, result) {
  var hooked = namespace[methodName];

  // replace original method with a hook
  namespace[methodName] = function() {
    var
      _this = this,
      outer = _this,
      mongoose = outer.mongooseHookPluginMongoose,
      hookPlugin = mongoose && mongoose.mongooseHookPlugin,
      outerArgs = arguments,
      T;

    // conditions to skip all the 'pre' and 'post' hooks
    if (!hookPlugin || !(outer.name in hookPlugin.collectionOpts) || typeof outerArgs[0] === 'function')
      return hooked.apply(outer, outerArgs);

    // declare database operation object; add request arguments
    T = {
      mongoose: mongoose,
      collection: outer,
      req: outerArgs,
      method: methodName,
      collectionOpts: hookPlugin.collectionOpts[outer.name]
    };

    // add named links to request arguments
    switch (T.method) {
      case 'insert':
        T.insert = T.req[0]; T.opts = T.req[1];
        break;
      case 'find':
      case 'findOne':
      case 'remove':
        T.query = T.req[0]; T.opts = T.req[1]; break;
      case 'mapReduce':
        T.opts = T.req[2]; T.query = T.opts.query;
        T.map = T.opts.map; T.reduce = T.opts.reduce;
        break;
      case 'update':
        T.query = T.req[0]; T.update = T.req[1]; T.opts = T.req[2];
        break;
      case 'findAndModify':
        T.query = T.req[0]; T.update = T.req[2]; T.opts = T.req[3];
        break;
    }

    // async call pre hook
    hookFunction.call(T, 'pre', function(after) {
      if (after) {
        var upstream = outerArgs[outerArgs.length - 1];

        // prepare 'post' hook
        if (typeof after === 'function') {
          outerArgs[outerArgs.length - 1] = function() {
            var
              _this = this,
              inner = _this,
              innerArgs = arguments;

            // add response arguments
            T.resScope = inner;
            T.res = innerArgs;

            // add named links to response arguments
            T.error = innerArgs[0];
            T.data = innerArgs[1];
            T.stats = innerArgs[2];

            // async call 'post' hook
            after.call(T, 'post', function() {
              upstream.apply(inner, innerArgs);
            });
          };
        }
      }

      // upstream to original method
      hooked.apply(outer, outerArgs);
    });
  };

  // return sync result (if specified)
  return result;
}

// hook for mongoose.model
hooks.model = function(name, schema) {
  var
    hookPlugin = this.mongooseHookPlugin,
    model = hookPlugin.modelHooked.apply(this, arguments); //call original

  // if schema is marked with this plugin, also mark the collection
  if (schema && schema.mongooseHookPlugins) {
    hookPlugin.collectionOpts[model.collection.name] = schema.mongooseHookPlugins;
    model.collection.mongooseHookPluginMongoose = this;
  }

  // return original result
  return model;
};

// hooks for final wrappers of DBMS API
hooks.collectionHook = function(stage, callback) {
  var
    _this = this,
    T = _this,
    plugins = T.collectionOpts.plugins,
    iterPlugins;

  // iterate through the hook-based plugins
  iterPlugins = function(pluginIdx) {
    if (pluginIdx >= plugins.length)
      return callback(hooks.collectionHook);

    var
      plugin = plugins[pluginIdx],
      next = function() {iterPlugins(pluginIdx + 1);},
      func = plugin[stage];

    // call the plugin's stage hook, if defined
    if (func) {
      // T is database operation object
      func.call(plugin, T, next);
    } else next();
  };
  iterPlugins(0);
};

// makes given mongoose object affected by this plugin
function patchMongoose(mongoose) {
  // patch only once
  if (mongoose.mongooseHookPlugin)
    return false;

  // hook the wrappers of database API
  [
    'aggregate',
    'findOne',
    'find',
    'mapReduce',
    'update',
    'remove',
    'insert',
    'findAndModify',
    'findAndRemove'
  ]
  .forEach(function(method) {
    hookAsync(mongoose.Collection.prototype, method, hooks.collectionHook);
  });

  // mark mongoose as patched
  mongoose.mongooseHookPlugin = {
    collectionOpts: {},
    modelHooked: mongoose.model
  };

  // hook the model generator
  mongoose.model = hooks.model;

  return true;
}

// emit mongoose plugin ( opts = {mongoose:, [pre:], [post:], ...} )
module.exports = function(schema, opts) {
  patchMongoose(opts.mongoose);

  // mark schema as involved into this plugin
  if (!schema.mongooseHookPlugins)
    schema.mongooseHookPlugins = {plugins: []};

  // register the caller plugin on this schema and its deriving models/collections
  if (opts)
    schema.mongooseHookPlugins.plugins.push(opts);
};
