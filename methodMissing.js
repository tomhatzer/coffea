/**
 * Source: https://gist.github.com/hagino3000/2290705
 * 
 * Enable route to __noSuchMethod__ when unknown method calling. 
 *
 * @param {Object} obj Target object.
 * @return {Object} 
 */
module.exports = function enableMethodMissing(obj) {

  var functionHandler = createBaseHandler({});
  functionHandler.get = function(receiver, name) {
    return function(){};
  }

  var calledProperty;
  var trapFn = Proxy.createFunction(functionHandler, function() {
    return obj.__noSuchMethod__(calledProperty, Array.prototype.slice.call(arguments));
  });

  var propertyAccessHandler = createBaseHandler(obj);
  propertyAccessHandler.get = function(receiver, name) {
    if (name in obj) {
      return obj[name];
    } else {
      calledProperty = name;
      return trapFn;
    }
  }
  return Proxy.create(propertyAccessHandler);

  /**
   * Create trap functions (internal)
   *
   * @param {Object} obj Original object.
   * @return {Object} Proxy handler.
   */
  function createBaseHandler(obj) {
    return {
      getOwnPropertyDescriptor: function(name) {
        var desc = Object.getOwnPropertyDescriptor(obj, name);
        if (desc !== undefined) { desc.configurable = true; }
        return desc;
      },
      getPropertyDescriptor: function(name) {
        var desc = Object.getPropertyDescriptor(obj, name);
        if (desc !== undefined) { desc.configurable = true; }
        return desc;
      },
      getOwnPropertyNames: function() {
        return Object.getOwnPropertyNames(obj);
      },
      getPropertyNames: function() {
        return Object.getPropertyNames(obj);
      },
      defineProperty: function(name, desc) {
        return Object.defineProperty(obj, name, desc);
      },
      delete: function(name) {
        return delete obj[name];
      },
      fix: function() {
        if (Object.isFrozen(obj)) {
          return Object.getOwnPropertyNames(obj).map(function(name) {
            return Object.getOwnPropertyDescriptor(obj, name);
          });
        }
        return undefined;
      },
      has: function(name) {
        return name in obj;
      },
      hasOwn: function(name) {
        return Object.prototype.hasOwnProperty.call(obj, name);
      },
      set: function(receiver, name, val) {
        // No check
        // But normally needs checking property descriptor
        obj[name] = val;
      },
      enumerate: function() {
        var result = [];
        for (var name in obj) { result.push(name); }
        return result;
      },
      keys: function() {
        return Object.keys(obj);
      }
    };
  }
}