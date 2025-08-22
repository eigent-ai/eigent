from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from sqlmodel import Session, select, or_
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from app.model.config.config import Config, ConfigCreate, ConfigUpdate, ConfigInfo, ConfigOut

router = APIRouter(tags=["Config Management"])


@router.get("/configs", name="list configs", response_model=list[ConfigOut])
async def list_configs(
    config_group: Optional[str] = None, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    query = select(Config)
    user_id = auth.user.id
    if user_id is not None:
        query = query.where(Config.user_id == user_id)
    if config_group is not None:
        query = query.where(Config.config_group == config_group)
    configs = session.exec(query).all()
    return configs


@router.get("/configs/{config_id}", name="get config", response_model=ConfigOut)
async def get_config(
    config_id: int,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    query = select(Config).where(Config.user_id == auth.user.id)

    if config_id is not None:
        query = query.where(Config.id == config_id)

    config = session.exec(query).first()

    if not config:
        raise HTTPException(status_code=404, detail=_("Configuration not found"))
    return config


@router.post("/configs", name="create config", response_model=ConfigOut)
async def create_config(config: ConfigCreate, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    if not ConfigInfo.is_valid_env_var(config.config_group, config.config_name):
        raise HTTPException(status_code=400, detail=_("Config Name is valid"))

    # Check if configuration already exists
    existing_config = session.exec(
        select(Config).where(Config.user_id == auth.user.id, Config.config_name == config.config_name)
    ).first()

    if existing_config:
        raise HTTPException(status_code=400, detail=_("Configuration already exists for this user"))

    db_config = Config(
        user_id=auth.user.id,
        config_name=config.config_name,
        config_value=config.config_value,
        config_group=config.config_group,
    )
    session.add(db_config)
    session.commit()
    session.refresh(db_config)
    return db_config


@router.put("/configs/{config_id}", name="update config", response_model=ConfigOut)
async def update_config(
    config_id: int, config_update: ConfigUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    db_config = session.exec(select(Config).where(Config.id == config_id, Config.user_id == auth.user.id)).first()

    if not db_config:
        raise HTTPException(status_code=404, detail=_("Configuration not found"))

    # Check if configuration group is valid
    if not ConfigInfo.is_valid_env_var(config_update.config_group, config_update.config_name):
        raise HTTPException(status_code=400, detail=_("Invalid configuration group"))

    # Check for conflicts with other configurations
    existing_config = session.exec(
        select(Config).where(
            Config.user_id == auth.user.id,
            Config.config_name == config_update.config_name,
            Config.id != config_id,
        )
    ).first()

    if existing_config:
        raise HTTPException(status_code=400, detail=_("Configuration already exists for this user"))

    db_config.config_name = config_update.config_name
    db_config.config_value = config_update.config_value

    session.add(db_config)
    session.commit()
    session.refresh(db_config)
    return db_config


@router.delete("/configs/{config_id}", name="delete config")
async def delete_config(config_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    db_config = session.exec(select(Config).where(Config.id == config_id, Config.user_id == auth.user.id)).first()

    if not db_config:
        raise HTTPException(status_code=404, detail=_("Configuration not found"))
    session.delete(db_config)
    session.commit()
    return Response(status_code=204)


@router.get("/config/info", name="get config info")
async def get_config_info(
    show_all: bool = Query(False, description="Show all config info, including those with empty env_vars"),
):
    configs = ConfigInfo.getinfo()
    if show_all:
        return configs
    return {k: v for k, v in configs.items() if v.get("env_vars") and len(v["env_vars"]) > 0}
