"""Engine factory and registry for managing STT engines."""
import importlib
import logging
from pathlib import Path
from typing import Dict, Type, Optional, Tuple, Any

from .base import EngineBase, EngineState

logger = logging.getLogger(__name__)


class EngineRegistry:
    """Registry for STT engine implementations.

    Engines can be registered manually or discovered automatically from
    the engines/ subdirectories.
    """

    _engines: Dict[str, Type[EngineBase]] = {}

    @classmethod
    def register(cls, engine_class: Type[EngineBase]) -> None:
        """Register an engine class.

        Args:
            engine_class: Engine class to register
        """
        info = engine_class.get_info()
        cls._engines[info.name] = engine_class
        logger.debug(f"Registered engine: {info.name} v{info.version}")

    @classmethod
    def get(cls, name: str) -> Optional[Type[EngineBase]]:
        """Get registered engine class by name.

        Args:
            name: Engine name

        Returns:
            Engine class or None if not found
        """
        return cls._engines.get(name)

    @classmethod
    def list_engines(cls) -> list:
        """List all registered engine names.

        Returns:
            List of engine names
        """
        return list(cls._engines.keys())

    @classmethod
    def get_engine_info(cls, name: str) -> Optional[dict]:
        """Get metadata for a specific engine.

        Args:
            name: Engine name

        Returns:
            Dictionary with engine info or None if not found
        """
        engine_class = cls.get(name)
        if engine_class is None:
            return None

        info = engine_class.get_info()
        return {
            "name": info.name,
            "version": info.version,
            "description": info.description,
            "supported_languages": info.supported_languages,
            "supports_streaming": info.supports_streaming,
            "requires_gpu": info.requires_gpu,
        }

    @classmethod
    def discover_engines(cls) -> None:
        """Auto-discover and register engines from subdirectories.

        Scans the engines/ directory for subdirectories containing
        engine.py files and registers them.
        """
        engines_dir = Path(__file__).parent
        for engine_dir in engines_dir.iterdir():
            if not engine_dir.is_dir():
                continue
            if engine_dir.name.startswith("_"):
                continue

            engine_file = engine_dir / "engine.py"
            if not engine_file.exists():
                continue

            # Import the engine module
            module_name = f"stt_worker.engines.{engine_dir.name}.engine"
            try:
                module = importlib.import_module(module_name)
                # Find engine class (convention: class name ends with "Engine")
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type)
                        and issubclass(attr, EngineBase)
                        and attr is not EngineBase
                        and attr_name.endswith("Engine")
                    ):
                        cls.register(attr)
                        break
            except Exception as e:
                logger.warning(f"Failed to load engine from {module_name}: {e}")


class EngineFactory:
    """Factory for creating and managing STT engine instances.

    Provides:
    - Engine instantiation with configuration
    - Fallback support if primary engine fails
    - Hot-swapping between engines
    """

    def __init__(self, global_config: Dict[str, Any]):
        """Initialize factory with global configuration.

        Args:
            global_config: Global configuration dictionary
        """
        self._global_config = global_config
        self._current_engine: Optional[EngineBase] = None
        self._current_engine_name: Optional[str] = None
        self._fallback_engine: Optional[EngineBase] = None
        self._fallback_engine_name: Optional[str] = None

    def create_engine(self, name: str, config: Optional[Dict[str, Any]] = None) -> Optional[EngineBase]:
        """Create an engine instance.

        Args:
            name: Engine name
            config: Optional engine-specific configuration

        Returns:
            Engine instance or None if not found
        """
        engine_class = EngineRegistry.get(name)
        if engine_class is None:
            logger.error(f"Engine not found: {name}")
            return None

        # Merge configs: defaults -> global -> engine-specific
        merged_config = {}
        merged_config.update(engine_class.get_default_config())
        merged_config.update(self._global_config)
        if config:
            merged_config.update(config)

        try:
            engine = engine_class(merged_config)
            logger.info(f"Created engine instance: {name}")
            return engine
        except Exception as e:
            logger.error(f"Failed to create engine {name}: {e}")
            return None

    def initialize(
        self,
        engine_name: str,
        config: Optional[Dict[str, Any]] = None,
        fallback: Optional[str] = None,
        fallback_config: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, str]:
        """Initialize the primary engine with optional fallback.

        Args:
            engine_name: Primary engine name
            config: Primary engine configuration
            fallback: Fallback engine name
            fallback_config: Fallback engine configuration

        Returns:
            Tuple of (success, message)
        """
        # Unload current engines
        if self._current_engine:
            self._current_engine.unload()
            self._current_engine = None

        if self._fallback_engine:
            self._fallback_engine.unload()
            self._fallback_engine = None

        # Create and load primary engine
        self._current_engine = self.create_engine(engine_name, config)
        if self._current_engine is None:
            return False, f"Failed to create engine: {engine_name}"

        if not self._current_engine.load():
            error_msg = self._current_engine.error or "Unknown error"

            # Try fallback if specified
            if fallback:
                logger.warning(f"Primary engine failed, trying fallback: {fallback}")
                self._fallback_engine = self.create_engine(fallback, fallback_config)
                if self._fallback_engine and self._fallback_engine.load():
                    self._current_engine = self._fallback_engine
                    self._current_engine_name = fallback
                    return True, f"Loaded fallback engine: {fallback}"
                else:
                    return False, f"Both primary and fallback engines failed. Primary: {error_msg}"

            return False, f"Failed to load engine: {error_msg}"

        self._current_engine_name = engine_name

        # Set up fallback engine if specified
        if fallback and fallback != engine_name:
            self._fallback_engine = self.create_engine(fallback, fallback_config)
            if self._fallback_engine:
                if self._fallback_engine.load():
                    self._fallback_engine_name = fallback
                else:
                    logger.warning(f"Fallback engine failed to load: {self._fallback_engine.error}")

        return True, f"Initialized engine: {engine_name}"

    def switch_engine(
        self,
        new_engine_name: str,
        config: Optional[Dict[str, Any]] = None,
        keep_fallback: bool = True,
    ) -> Tuple[bool, str]:
        """Hot-swap to a different engine.

        Args:
            new_engine_name: Name of the new engine to use
            config: Configuration for the new engine
            keep_fallback: Whether to keep the fallback engine loaded

        Returns:
            Tuple of (success, message)
        """
        # Create new engine
        new_engine = self.create_engine(new_engine_name, config)
        if new_engine is None:
            return False, f"Engine not found: {new_engine_name}"

        # Load new engine
        if not new_engine.load():
            error_msg = new_engine.error or "Unknown error"
            return False, f"Failed to load new engine: {error_msg}"

        # Unload old engine
        old_name = self._current_engine_name
        if self._current_engine:
            self._current_engine.unload()

        # Unload fallback if not keeping it
        if not keep_fallback and self._fallback_engine:
            self._fallback_engine.unload()
            self._fallback_engine = None
            self._fallback_engine_name = None

        # Switch to new engine
        self._current_engine = new_engine
        self._current_engine_name = new_engine_name

        logger.info(f"Switched engine from {old_name} to {new_engine_name}")
        return True, f"Switched to engine: {new_engine_name}"

    def get_engine(self) -> Optional[EngineBase]:
        """Get current active engine.

        Returns:
            Current engine instance or None
        """
        return self._current_engine

    def get_engine_name(self) -> Optional[str]:
        """Get current engine name.

        Returns:
            Current engine name or None
        """
        return self._current_engine_name

    def is_ready(self) -> bool:
        """Check if current engine is ready.

        Returns:
            True if engine is ready for transcription
        """
        return self._current_engine is not None and self._current_engine.is_ready()