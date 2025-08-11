from camel.toolkits import ThinkingToolkit as BaseThinkingToolkit

from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class ThinkingToolkit(BaseThinkingToolkit, AbstractToolkit):

    def __init__(self, api_task_id: str, agent_name: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id
        self.agent_name = agent_name

    @listen_toolkit(BaseThinkingToolkit.plan)
    def plan(self, plan: str) -> str:
        return super().plan(plan)

    @listen_toolkit(BaseThinkingToolkit.hypothesize)
    def hypothesize(self, hypothesis: str) -> str:
        return super().hypothesize(hypothesis)

    @listen_toolkit(BaseThinkingToolkit.think)
    def think(self, thought: str) -> str:
        return super().think(thought)

    @listen_toolkit(BaseThinkingToolkit.contemplate)
    def contemplate(self, contemplation: str) -> str:
        return super().contemplate(contemplation)

    @listen_toolkit(BaseThinkingToolkit.critique)
    def critique(self, critique: str) -> str:
        return super().critique(critique)

    @listen_toolkit(BaseThinkingToolkit.synthesize)
    def synthesize(self, synthesis: str) -> str:
        return super().synthesize(synthesis)

    @listen_toolkit(BaseThinkingToolkit.reflect)
    def reflect(self, reflection: str) -> str:
        return super().reflect(reflection)
