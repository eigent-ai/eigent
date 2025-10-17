from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from sqlmodel import Session, select, or_
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from app.model.config.config import Config, ConfigCreate, ConfigUpdate, ConfigInfo, ConfigOut
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_config_controller")

router = APIRouter(tags=["Config Management"])


@router.get("/configs", name="list configs", response_model=list[ConfigOut])
@traceroot.trace()
async def list_configs(
    config_group: Optional[str] = None, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """List user's configurations with optional group filtering."""
    user_id = auth.user.id
    query = select(Config).where(Config.user_id == user_id)
    
    if config_group is not None:
        query = query.where(Config.config_group == config_group)
    
    configs = session.exec(query).all()
    logger.debug("Configs listed", extra={"user_id": user_id, "config_group": config_group, "count": len(configs)})
    return configs


@router.get("/configs/{config_id}", name="get config", response_model=ConfigOut)
@traceroot.trace()
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
        logger.warning("Config not found")
        raise HTTPException(status_code=404, detail=_("Configuration not found"))
    
    logger.debug("Config retrieved")
    return config


@router.post("/configs", name="create config", response_model=ConfigOut)
@traceroot.trace()
async def create_config(config: ConfigCreate, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Create new configuration."""
    user_id = auth.user.id
    
    if not ConfigInfo.is_valid_env_var(config.config_group, config.config_name):
        logger.warning("Config validation failed", extra={"user_id": user_id, "config_group": config.config_group, "config_name": config.config_name})
        raise HTTPException(status_code=400, detail=_("Invalid config name or group"))

    # Check if configuration already exists
    existing_config = session.exec(
        select(Config).where(Config.user_id == user_id, Config.config_name == config.config_name)
    ).first()

    if existing_config:
        logger.warning("Config creation failed: already exists", extra={"user_id": user_id, "config_name": config.config_name})
        raise HTTPException(status_code=400, detail=_("Configuration already exists for this user"))

    try:
        db_config = Config(
            user_id=user_id,
            config_name=config.config_name,
            config_value=config.config_value,
            config_group=config.config_group,
        )
        session.add(db_config)
        session.commit()
        session.refresh(db_config)
        logger.info("Config created", extra={"user_id": user_id, "config_id": db_config.id, "config_group": config.config_group, "config_name": config.config_name})
        return db_config
    except Exception as e:
        session.rollback()
        logger.error("Config creation failed", extra={"user_id": user_id, "config_name": config.config_name, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/configs/{config_id}", name="update config", response_model=ConfigOut)
@traceroot.trace()
async def update_config(
    config_id: int, config_update: ConfigUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Update configuration."""
    user_id = auth.user.id
    db_config = session.exec(select(Config).where(Config.id == config_id, Config.user_id == user_id)).first()

    if not db_config:
        logger.warning("Config not found for update", extra={"user_id": user_id, "config_id": config_id})
        raise HTTPException(status_code=404, detail=_("Configuration not found"))

    # Check if configuration group is valid
    if not ConfigInfo.is_valid_env_var(config_update.config_group, config_update.config_name):
        logger.warning("Config update validation failed", extra={"user_id": user_id, "config_id": config_id, "config_group": config_update.config_group})
        raise HTTPException(status_code=400, detail=_("Invalid configuration group"))

    # Check for conflicts with other configurations
    existing_config = session.exec(
        select(Config).where(
            Config.user_id == user_id,
            Config.config_name == config_update.config_name,
            Config.id != config_id,
        )
    ).first()

    if existing_config:
        logger.warning("Config update failed: duplicate name", extra={"user_id": user_id, "config_id": config_id, "config_name": config_update.config_name})
        raise HTTPException(status_code=400, detail=_("Configuration already exists for this user"))

    try:
        db_config.config_name = config_update.config_name
        db_config.config_value = config_update.config_value
        db_config.config_group = config_update.config_group
        session.add(db_config)
        session.commit()
        session.refresh(db_config)
        logger.info("Config updated", extra={"user_id": user_id, "config_id": config_id, "config_group": config_update.config_group})
        return db_config
    except Exception as e:
        session.rollback()
        logger.error("Config update failed", extra={"user_id": user_id, "config_id": config_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/configs/{config_id}", name="delete config")
@traceroot.trace()
async def delete_config(config_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete configuration."""
    user_id = auth.user.id
    db_config = session.exec(select(Config).where(Config.id == config_id, Config.user_id == user_id)).first()

    if not db_config:
        logger.warning("Config not found for deletion", extra={"user_id": user_id, "config_id": config_id})
        raise HTTPException(status_code=404, detail=_("Configuration not found"))

    try:
        session.delete(db_config)
        session.commit()
        logger.info("Config deleted", extra={"user_id": user_id, "config_id": config_id, "config_name": db_config.config_name})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("Config deletion failed", extra={"user_id": user_id, "config_id": config_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/config/info", name="get config info")
@traceroot.trace()
async def get_config_info(
    show_all: bool = Query(False, description="Show all config info, including those with empty env_vars"),
):
    """Get available configuration templates and info."""
    configs = ConfigInfo.getinfo()
    if show_all:
        logger.debug("Config info retrieved", extra={"show_all": True, "count": len(configs)})
        return configs
    
    filtered = {k: v for k, v in configs.items() if v.get("env_vars") and len(v["env_vars"]) > 0}
    logger.debug("Config info retrieved", extra={"show_all": False, "total_count": len(configs), "filtered_count": len(filtered)})
    return filtered