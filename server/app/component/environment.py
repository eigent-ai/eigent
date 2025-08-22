import importlib.util
import os
from pathlib import Path
from fastapi import APIRouter, FastAPI
from dotenv import load_dotenv
import importlib
from typing import Any, overload


load_dotenv()


@overload
def env(key: str) -> str | None: ...


@overload
def env(key: str, default: str) -> str: ...


@overload
def env(key: str, default: Any) -> Any: ...


def env(key: str, default=None):
    return os.getenv(key, default)


def env_or_fail(key: str):
    value = env(key)
    if value is None:
        raise Exception("can't get env config value.")
    return value


def env_not_empty(key: str):
    value = env(key)
    if not value:
        raise Exception("env config value can't be empty.")
    return value


def base_path():
    return Path(__file__).parent.parent.parent


def to_path(path: str):
    return base_path() / path


def auto_import(package: str):
    """
    自动导入指定目录下的全部py文件
    """
    # 获取文件夹下的所有文件名
    folder = package.replace(".", "/")
    files = os.listdir(folder)

    # 导入文件夹下的所有.py文件
    for file in files:
        if file.endswith(".py") and not file.startswith("__"):
            module_name = file[:-3]  # 去掉文件名的扩展名.py
            importlib.import_module(package + "." + module_name)


def auto_include_routers(api: FastAPI, prefix: str, directory: str):
    """
    自动扫描指定目录下的所有模块并注册路由

    :param api: FastAPI 实例
    :param prefix: 路由前缀
    :param directory: 要扫描的目录路径
    """
    # 将目录转换为绝对路径
    dir_path = Path(directory).resolve()

    # 遍历目录下所有.py文件
    for root, _, files in os.walk(dir_path):
        for file_name in files:
            if file_name.endswith("_controller.py") and not file_name.startswith("__"):
                # 构造完整文件路径
                file_path = Path(root) / file_name

                # 生成模块名称
                module_name = file_path.stem

                # 使用importlib加载模块
                spec = importlib.util.spec_from_file_location(module_name, file_path)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                # 检查模块中是否存在router属性且是APIRouter实例
                router = getattr(module, "router", None)
                if isinstance(router, APIRouter):
                    api.include_router(router, prefix=prefix)
