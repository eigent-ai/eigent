import inspect


def dump_class(obj, max_val_len=1000):
    cls = obj.__class__
    print(f"Class: {cls.__name__}")
    print("Attributes:")
    for name, val in vars(obj).items():
        val_str = repr(val)
        if len(val_str) > max_val_len:
            val_str = val_str[:max_val_len] + "... [truncated]"
        print(f"  {name} = {val_str}")
    # print("Methods:")
    # for name, method in inspect.getmembers(cls, predicate=inspect.isfunction):
    #     print(f"  {name}()")
