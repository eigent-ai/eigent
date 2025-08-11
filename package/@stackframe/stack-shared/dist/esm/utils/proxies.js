// src/utils/proxies.tsx
import { nicify } from "./strings";
function logged(name, toLog, options = {}) {
  const proxy = new Proxy(toLog, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig === "function") {
        return function(...args) {
          const success = (v, isPromise) => console.debug(`logged(...): Called ${name}.${String(prop)}(${args.map((a) => nicify(a)).join(", ")}) => ${isPromise ? "Promise<" : ""}${nicify(result)}${isPromise ? ">" : ""}`, { this: this, args, promise: isPromise ? result : false, result: v, trace: new Error() });
          const error = (e, isPromise) => console.debug(`logged(...): Error in ${name}.${String(prop)}(${args.map((a) => nicify(a)).join(", ")})`, { this: this, args, promise: isPromise ? result : false, error: e, trace: new Error() });
          let result;
          try {
            result = orig.apply(this, args);
          } catch (e) {
            error(e, false);
            throw e;
          }
          if (result instanceof Promise) {
            result.then((v) => success(v, true)).catch((e) => error(e, true));
          } else {
            success(result, false);
          }
          return result;
        };
      }
      return orig;
    },
    set(target, prop, value) {
      console.log(`Setting ${name}.${String(prop)} to ${value}`);
      return Reflect.set(target, prop, value);
    },
    apply(target, thisArg, args) {
      console.log(`Calling ${name}(${JSON.stringify(args).slice(1, -1)})`);
      return Reflect.apply(target, thisArg, args);
    },
    construct(target, args, newTarget) {
      console.log(`Constructing ${name}(${JSON.stringify(args).slice(1, -1)})`);
      return Reflect.construct(target, args, newTarget);
    },
    defineProperty(target, prop, descriptor) {
      console.log(`Defining ${name}.${String(prop)} as ${JSON.stringify(descriptor)}`);
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      console.log(`Deleting ${name}.${String(prop)}`);
      return Reflect.deleteProperty(target, prop);
    },
    setPrototypeOf(target, prototype) {
      console.log(`Setting prototype of ${name} to ${prototype}`);
      return Reflect.setPrototypeOf(target, prototype);
    },
    preventExtensions(target) {
      console.log(`Preventing extensions of ${name}`);
      return Reflect.preventExtensions(target);
    }
  });
  return proxy;
}
function createLazyProxy(factory) {
  let cache = void 0;
  let initialized = false;
  function initializeIfNeeded() {
    if (!initialized) {
      cache = factory();
      initialized = true;
    }
    return cache;
  }
  return new Proxy({}, {
    get(target, prop, receiver) {
      const instance = initializeIfNeeded();
      return Reflect.get(instance, prop, receiver);
    },
    set(target, prop, value, receiver) {
      const instance = initializeIfNeeded();
      return Reflect.set(instance, prop, value, receiver);
    },
    has(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.has(instance, prop);
    },
    deleteProperty(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.deleteProperty(instance, prop);
    },
    ownKeys(target) {
      const instance = initializeIfNeeded();
      return Reflect.ownKeys(instance);
    },
    getOwnPropertyDescriptor(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.getOwnPropertyDescriptor(instance, prop);
    },
    defineProperty(target, prop, descriptor) {
      const instance = initializeIfNeeded();
      return Reflect.defineProperty(instance, prop, descriptor);
    },
    getPrototypeOf(target) {
      const instance = initializeIfNeeded();
      return Reflect.getPrototypeOf(instance);
    },
    setPrototypeOf(target, proto) {
      const instance = initializeIfNeeded();
      return Reflect.setPrototypeOf(instance, proto);
    },
    isExtensible(target) {
      const instance = initializeIfNeeded();
      return Reflect.isExtensible(instance);
    },
    preventExtensions(target) {
      const instance = initializeIfNeeded();
      return Reflect.preventExtensions(instance);
    },
    apply(target, thisArg, argumentsList) {
      const instance = initializeIfNeeded();
      return Reflect.apply(instance, thisArg, argumentsList);
    },
    construct(target, argumentsList, newTarget) {
      const instance = initializeIfNeeded();
      return Reflect.construct(instance, argumentsList, newTarget);
    }
  });
}
export {
  createLazyProxy,
  logged
};
//# sourceMappingURL=proxies.js.map