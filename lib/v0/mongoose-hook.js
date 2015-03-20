'use strict';

// version ID for original injection
var pluginSpec = 'mongooseHookPlugin_2015_03_20';

var pluginSpec_mongoose = pluginSpec + '_mongoose';
var pluginSpec_plugins = pluginSpec + '_plugins';

var hooks = {};

// async hook injector for mongoose database API wrappers
function hookAsync(namespace, methodName, hookFunction, result) {
  var hooked = namespace[methodName];

  // replace original method with a hook
  namespace[methodName] = function() {
    var _this = this;
    var outer = _this;
    var mongoose = outer[pluginSpec_mongoose];
    var hookPlugin = mongoose && mongoose[pluginSpec];
    var outerArgs = arguments;
    var T;

    // conditions to skip all the 'pre' and 'post' hooks
    if (
      !hookPlugin ||
      !(outer.name in hookPlugin.collectionOpts) ||
      typeof outerArgs[0] === 'function'
    ) {
      return hooked.apply(outer, outerArgs);
    }

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
        T.insert = T.req[0];
        T.opts = T.req[1];
        break;

      case 'find':
      case 'findOne':
      case 'remove':
        T.query = T.req[0];
        T.opts = T.req[1];
        break;

      case 'aggregate':
        T.pipe = T.req[0];
        T.opts = T.req[1];
        var match = T.pipe && T.pipe[0] && T.pipe[0].match;
        if (match) T.query = match;
        break;

      case 'mapReduce':
        T.opts = T.req[2];
        T.query = T.opts.query;
        T.map = T.opts.map;
        T.reduce = T.opts.reduce;
        break;

      case 'update':
        T.query = T.req[0];
        T.update = T.req[1];
        T.opts = T.req[2];
        if (T.opts && T.opts.upsert && T.update) T.insert = T.update.$setOnInsert;
        break;

      case 'findAndModify':
        T.query = T.req[0];
        T.update = T.req[2];
        T.opts = T.req[3];
        if (T.opts && T.opts.upsert && T.update) T.insert = T.update.$setOnInsert;
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
  var hookPlugin = this[pluginSpec];
  var model = hookPlugin.modelHooked.apply(this, arguments); //call original

  // if schema is marked with this plugin, also mark the collection
  if (schema && schema[pluginSpec_plugins]) {
    hookPlugin.collectionOpts[model.collection.name] = schema[pluginSpec_plugins];
    model.collection[pluginSpec_mongoose] = this;
  }

  // return original result
  return model;
};

// hooks for final wrappers of DBMS API
hooks.collectionHook = function(stage, callback) {
  var _this = this;
  var T = _this;
  var plugins = T.collectionOpts.plugins;

  // iterate through the hook-based plugins
  var iterPlugins = function(pluginIdx) {
    if (pluginIdx >= plugins.length) return callback(hooks.collectionHook);

    var plugin = plugins[pluginIdx];
    var next = function() {iterPlugins(pluginIdx + 1);};
    var func = plugin[stage];

    // call the plugin's stage hook, if defined
    if (func) {
      // T is database operation object
      func.call(plugin, T, next);
    } else next();
  };
  iterPlugins(0);
};

// method to get model by collection name
hooks.getModel = function() {
  var mongoose = this[pluginSpec_mongoose];
  if (!mongoose) return null;

  var P = mongoose[pluginSpec];
  var cached = P.modelByCollection[this.name];
  if (cached) return cached;

  // find schema within models
  var i;
  var models = this.conn.models;

  for (i in models) {
    var model = models[i];
    if (model.collection === this) {
      P.modelByCollection[this.name] = model;
      return model;
    }
  }

  return null;
};

// makes given mongoose object affected by this plugin
function patchMongoose(mongoose) {
  // patch only once
  if (mongoose[pluginSpec]) return false;

  var MCP = mongoose.Collection.prototype;

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
    hookAsync(MCP, method, hooks.collectionHook);
  });

  // mark mongoose as patched
  mongoose[pluginSpec] = {
    collectionOpts: {},
    modelHooked: mongoose.model,
    modelByCollection: {}
  };

  // hook the model generator
  mongoose.model = hooks.model;

  // emit getModel method on Collection
  if (!MCP.getModel) MCP.getModel = hooks.getModel;

  return true;
}

// emit mongoose plugin
// opts = {
  // mongoose: Mongoose, // instance to patch,
  // pre: function(params, callback), // optional
  // post: function(params, callback), // optional
  // name: String, // optional name of sub-plugin
  // once: Boolean, // optional; if specified and has `name`, don't add a duplicate
  // replace: Boolean, // optional; if specified with `once`, will replace old one
  // top: Boolean // if specified, make this sub-plugin highest priority
// }
module.exports = function(schema, opts) {
  patchMongoose(opts.mongoose || require('mongoose'));

  // mark schema as involved into this plugin
  if (!schema[pluginSpec_plugins]) schema[pluginSpec_plugins] = {plugins: []};

  // register the caller plugin on this schema and its deriving models/collections
  if (opts) {
    var p = schema[pluginSpec_plugins].plugins;

    if (opts.once && opts.name) for (var i in p) if (p[i].name === opts.name) {
      if (opts.replace) {
        delete p[i];
        break;
      } else return;
    }

    if (opts.top) p.unshift(opts); else p.push(opts);
  }
};
