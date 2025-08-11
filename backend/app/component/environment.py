import importlib.util
import os
from pathlib import Path
from fastapi import APIRouter, FastAPI
from dotenv import load_dotenv
import importlib
from typing import Any, overload


env_path = os.path.join(os.path.expanduser("~"), ".eigent", ".env")
load_dotenv(dotenv_path=env_path)


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
    Automatically import all Python files in the specified directory
    """
    # Get all file names in the folder
    folder = package.replace(".", "/")
    files = os.listdir(folder)

    # Import all .py files in the folder
    for file in files:
        if file.endswith(".py") and not file.startswith("__"):
            module_name = file[:-3]  # Remove the .py extension from filename
            importlib.import_module(package + "." + module_name)


def auto_include_routers(api: FastAPI, prefix: str, directory: str):
    """
    Automatically scan all modules in the specified directory and register routes

    :param api: FastAPI instance
    :param prefix: Route prefix
    :param directory: Directory path to scan
    """
    # Convert directory to absolute path
    dir_path = Path(directory).resolve()

    # Traverse all .py files in the directory
    for root, _, files in os.walk(dir_path):
        for file_name in files:
            if file_name.endswith("_controller.py") and not file_name.startswith("__"):
                # Construct complete file path
                file_path = Path(root) / file_name

                # Generate module name
                module_name = file_path.stem

                # Load module using importlib
                spec = importlib.util.spec_from_file_location(module_name, file_path)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                # Check if router attribute exists in module and is an APIRouter instance
                router = getattr(module, "router", None)
                if isinstance(router, APIRouter):
                    api.include_router(router, prefix=prefix)
