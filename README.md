# mongoose-hook
Abstract mongoose plugin, allowing usage of 'pre' and 'post' hooks on internal direct wrappers to database API for all (including static) mongoose operations.

# Installation
```shell
git clone git@github.com:tarquas/mongoose-hook.git mongoose-hook
```

# Package
```js
{
  "mongoose-hook": "tarquas/mongoose-hook#72531d8ebc"
}
```

# Usage

Example: A plugin to mark every new document with some watermark (uses pre 'insert' hook):

`mongoose-watermark.js`
```js
'use strict';

var
  hookPlugin = require('./mongoose-hook'),
  thisPlugin = {};

thisPlugin.pre = function(p, callback) {
  switch (p.method) {
    case 'insert':
      p.insert[this.watermarkPath] = this.watermarkValue;
      break;
  }

  callback();
};

module.exports = function(schema, opts) {
  schema.plugin(hookPlugin, {
    mongoose: opts.mongoose,
    pre: thisPlugin.pre,
    watermarkPath: opts.path || 'watermark',
    watermarkValue: opts.value
  });
};
```

Usage of plugin: adds a field to every new document, specifying which process ID created it:

`watermark-example.js`
```js
var
  mongoose = require('mongoose'),
  watermarkPlugin = require('./mongoose-watermark');
  
mongoose.plugin(watermarkPlugin, {
  mongoose: mongoose,
  path: 'createdByProcess',
  value: process.pid
});
```

# Notes

* Hook plugin must be provided with an exact instance of `mongoose`, where the processing models expected to be processed in `opts` parameter. The plugin correctly handles the hooking on multiple `mongoose` instances.

* Comparing the code above with the following:

```js
schema.post('save', function(next) {
  this.createdByProcess = process.pid;
  next();
});
```

The difference is that post 'save' hook is not called for `Model.create(...)` method; the post 'insert' hook is called in either case, because mongoose calls underlying `insert` wrapper of database API anyway.

* `this` object, which is passed to hook function is an instance of `mongoose.Collection`. Please, refer to `mongoose` manuals for its API. Also, this plugin adds `getModel()` method to `mongoose.Collection` prototype, which returns a `Model` (made by `mongoose.model()`), which refers to given `mongoose.Collection` instance.
