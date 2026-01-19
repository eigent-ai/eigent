import importlib.util
import os
from pathlib import Path
from fastapi import APIRouter, FastAPI
from dotenv import load_dotenv
import importlib
from typing import Any, overload
import logging

logger = logging.getLogger("environment")

logger.info("Loading environment variables from .env file")
load_dotenv()
logger.info("Environment variables loaded successfully")


@overload
def env(key: str) -> str | None: ...


@overload
def env(key: str, default: str) -> str: ...


@overload
def env(key: str, default: Any) -> Any: ...


def env(key: str, default=None):
    value = os.getenv(key, default)
    logger.debug("Environment variable accessed", extra={"key": key, "has_value": value is not None, "using_default": value == default})
    return value


def env_or_fail(key: str):
    value = env(key)
    if value is None:
        logger.error("Required environment variable missing", extra={"key": key})
        raise Exception("can't get env config value.")
    logger.debug("Required environment variable retrieved", extra={"key": key})
    return value


def env_not_empty(key: str):
    value = env(key)
    if not value:
        logger.error("Environment variable is empty", extra={"key": key})
        raise Exception("env config value can't be empty.")
    logger.debug("Non-empty environment variable retrieved", extra={"key": key})
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
    logger.info("Starting automatic router registration", extra={
        "prefix": prefix,
        "directory": directory
    })

    # 将目录转换为绝对路径
    dir_path = Path(directory).resolve()
    router_count = 0

    # 遍历目录下所有.py文件
    for root, _, files in os.walk(dir_path):
        for file_name in files:
            if file_name.endswith("_controller.py") and not file_name.startswith("__"):
                # 构造完整文件路径
                file_path = Path(root) / file_name

                logger.debug("Processing controller file", extra={
                    "file_name": file_name,
                    "file_path": str(file_path)
                })

                # 生成模块名称
                module_name = file_path.stem

                try:
                    # 使用importlib加载模块
                    spec = importlib.util.spec_from_file_location(module_name, file_path)
                    if spec is None or spec.loader is None:
                        logger.warning("Failed to create module spec", extra={"file_path": str(file_path)})
                        continue
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    # 检查模块中是否存在router属性且是APIRouter实例
                    router = getattr(module, "router", None)
                    if isinstance(router, APIRouter):
                        api.include_router(router, prefix=prefix)
                        router_count += 1
                        logger.debug("Router registered successfully", extra={
                            "module_name": module_name,
                            "prefix": prefix
                        })
                    else:
                        logger.debug("No valid router found in module", extra={"module_name": module_name})

                except Exception as e:
                    logger.error("Failed to load controller module", extra={
                        "module_name": module_name,
                        "file_path": str(file_path),
                        "error": str(e)
                    }, exc_info=True)

    logger.info("Automatic router registration completed", extra={
        "prefix": prefix,
        "directory": directory,
        "routers_registered": router_count
    })
