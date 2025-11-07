import { useState, useEffect } from "react";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	CodeXml,
	FileText,
	Globe,
	List,
	Table,
	Image,
	Bird,
	Bot,
	CirclePause,
	Ellipsis,
	Trash2,
	Share,
	CirclePlay,
} from "lucide-react";
import folderIcon from "@/assets/Folder-1.svg";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useGlobalStore } from "@/store/globalStore";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
	PopoverClose,
} from "@/components/ui/popover";
import {
	fetchPut,
	proxyFetchDelete,
	proxyFetchGet,
} from "@/api/http";
import { Tag } from "@/components/ui/tag";
import { share } from "@/lib/share";
import { useTranslation } from "react-i18next";
import AlertDialog from "@/components/ui/alertDialog";


export default function Project() {
	const {t} = useTranslation()
	const navigate = useNavigate();
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	const { history_type, setHistoryType } = useGlobalStore();
	const [historyTasks, setHistoryTasks] = useState<any[]>([]);
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [curHistoryId, setCurHistoryId] = useState("");
	const agentMap = {
		developer_agent: {
			name: t("dashboard.developer-agent"),
			textColor: "text-text-developer",
			bgColor: "bg-bg-fill-coding-active",
			shapeColor: "bg-bg-fill-coding-default",
			borderColor: "border-bg-fill-coding-active",
			bgColorLight: "bg-emerald-200",
		},
		search_agent: {
			name: t("dashboard.search-agent"),

			textColor: "text-blue-700",
			bgColor: "bg-bg-fill-browser-active",
			shapeColor: "bg-bg-fill-browser-default",
			borderColor: "border-bg-fill-browser-active",
			bgColorLight: "bg-blue-200",
		},
		document_agent: {
			name: t("dashboard.document-agent"),

			textColor: "text-yellow-700",
			bgColor: "bg-bg-fill-writing-active",
			shapeColor: "bg-bg-fill-writing-default",
			borderColor: "border-bg-fill-writing-active",
			bgColorLight: "bg-yellow-200",
		},
		multi_modal_agent: {
			name: t("dashboard.multi-modal-agent"),

			textColor: "text-fuchsia-700",
			bgColor: "bg-bg-fill-multimodal-active",
			shapeColor: "bg-bg-fill-multimodal-default",
			borderColor: "border-bg-fill-multimodal-active",
			bgColorLight: "bg-fuchsia-200",
		},
		social_medium_agent: {
			name: t("dashboard.social-media-agent"),

			textColor: "text-purple-700",
			bgColor: "bg-violet-700",
			shapeColor: "bg-violet-300",
			borderColor: "border-violet-700",
			bgColorLight: "bg-purple-50",
		},
	};

	const agentIconMap = {
		developer_agent: (
			<CodeXml
				className={`!h-[10px] !w-[10px] ${agentMap.developer_agent.textColor}`}
			/>
		),
		search_agent: (
			<Globe
				className={`!h-[10px] !w-[10px] ${agentMap.search_agent.textColor}`}
			/>
		),
		document_agent: (
			<FileText
				className={`!h-[10px] !w-[10px] ${agentMap.document_agent.textColor}`}
			/>
		),
		multi_modal_agent: (
			<Image
				className={`!h-[10px] !w-[10px] ${agentMap.multi_modal_agent.textColor}`}
			/>
		),
		social_medium_agent: (
			<Bird
				className={`!h-[10px] !w-[10px] ${agentMap.social_medium_agent.textColor}`}
			/>
		),
	};

	const handleClickAgent = (taskId: string, agent_id: string) => {
		chatStore.setActiveTaskId(taskId);
		chatStore.setActiveWorkSpace(taskId, "workflow");
		chatStore.setActiveAgent(taskId, agent_id);
		navigate(`/`);
	};

	const handleDelete = (id: string) => {
		setCurHistoryId(id);
		setDeleteModalOpen(true);
	};

	const confirmDelete = async () => {
		const id = curHistoryId;
		if (!id) return;
		try {
			await proxyFetchDelete(`/api/chat/history/${id}`);
			setHistoryTasks((list) => list.filter((item) => item.id !== id));
			if (chatStore.tasks[id]) {
				chatStore.removeTask(id);
			}
		} catch (error) {
			console.error("Failed to delete history task:", error);
		} finally {
			setCurHistoryId("");
			setDeleteModalOpen(false);
		}
	};

	const handleShare = async (taskId: string) => {
		share(taskId);
	};

	const handleReplay = async (taskId: string, question: string) => {
		chatStore.replay(taskId, question, 0);
		navigate({ pathname: "/" });
	};

	const handleSetActive = (taskId: string, question: string) => {
		const task = chatStore.tasks[taskId];
		if (task) {
			// if there is a record, display the result
			chatStore.setActiveTaskId(taskId);
			navigate(`/`);
		} else {
			// if there is no record, execute replay
			handleReplay(taskId, question);
		}
	};

	const handleTakeControl = (type: "pause" | "resume", taskId: string) => {
		if (type === "pause") {
			let { taskTime, elapsed } = chatStore.tasks[taskId];

			const now = Date.now();
			elapsed += now - taskTime;
			chatStore.setElapsed(taskId, elapsed);
			chatStore.setTaskTime(taskId, 0);
		} else {
			chatStore.setTaskTime(taskId, Date.now());
		}
		fetchPut(`/task/${taskId}/take-control`, {
			action: type,
		});
		if (type === "pause") {
			chatStore.setStatus(taskId, "pause");
		} else {
			chatStore.setStatus(taskId, "running");
		}
	};


	useEffect(() => {
		const fetchHistoryTasks = async () => {
			try {
				const res = await proxyFetchGet(`/api/chat/histories`);
				setHistoryTasks(res.items);
			} catch (error) {
				console.error("Failed to fetch history tasks:", error);
			}
		};

		fetchHistoryTasks();
	}, []);

	// Feature flag to hide table view without deleting code
	const TABLE_VIEW_ENABLED = false;

	return (
      <div className="flex flex-col h-full max-w-[900px] mx-auto py-4">
          {/* alert dialog */}
        <AlertDialog
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={confirmDelete}
          title={t("layout.delete-task")}
          message={t("layout.delete-task-confirmation")}
          confirmText={t("layout.delete")}
          cancelText={t("layout.cancel")}
        />
        <div className="px-6 py-4 flex justify-between items-center">
          <div className="text-body-lg font-bold">{t("dashboard.ongoing-tasks")}</div>
          <div className="flex items-center gap-md">
            {TABLE_VIEW_ENABLED && (
            <Tabs
              value={history_type}
              onValueChange={(value) =>
                setHistoryType(value as "table" | "list")
              }
            >
              <TabsList className="p-1 h-[28px] ">
                <TabsTrigger value="table">
                  <Table size={16} />
                  <div>{t("dashboard.table")}</div>
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List size={16} />
                  <div>{t("dashboard.list")}</div>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            )}
          </div>
        </div>
        {TABLE_VIEW_ENABLED && history_type === "table" ? (
          // Table
          <div className="p-6 flex justify-start items-center flex-wrap gap-6">
            {Object.keys(chatStore.tasks).map((taskId) => {
              const task = chatStore.tasks[taskId];
              return task.status != "finished" && !task.type ? (
                <div
                  key={taskId}
                  onClick={() => {
                    chatStore.setActiveTaskId(taskId);
                    navigate(`/`);
                  }}
                  className={`${
                    chatStore.activeTaskId === taskId ? "!bg-white-100%" : ""
                  }  relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-3xl flex justify-between items-center gap-md flex-initial w-[calc(33%-48px)] min-w-[300px] max-w-[500px] h-[180px] px-6 shadow-history-item`}
                >
                  <div className="w-[133px] py-md h-full flex flex-col gap-1">
                    <div className="flex-1 flex justify-start items-end">
                      <img
                        className="w-[60px] h-[60px]"
                        src={folderIcon}
                        alt="folder-icon"
                      />
                    </div>
                    <div className="text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis whitespace-nowrap">
                      {task.summaryTask || t("dashboard.new-project")}
                    </div>
                    <div className="w-full">
                      <Progress
                        value={task.progressValue}
                        className="h-[2px] w-full"
                      />
                    </div>
                  </div>
                  <div className="w-[133px] pt-md h-full flex flex-col gap-sm">
                    <div className="flex justify-between items-center ">
                      <div className="text-xs leading-17 font-medium text-text-secondary">
                        {t("layout.tasks")}
                      </div>
                      <div className="text-xs leading-17 font-medium text-text-tertiary">
                        {task.taskRunning?.filter(
                          (taskItem) =>
                            taskItem.status === "completed" ||
                            taskItem.status === "failed"
                        ).length || 0}
                        /{task.taskRunning?.length || 0}
                      </div>
                    </div>
                    <div className="w-[133px] h-full overflow-y-auto scrollbar-hide  flex flex-col gap-sm">
                      {task.taskAssigning.map(
                        (taskAssigning) =>
                          taskAssigning.status === "running" && (
                            <div
                              key={taskAssigning.agent_id}
                              onClick={() =>
                                handleClickAgent(
                                  taskId,
                                  taskAssigning.agent_id as AgentNameType
                                )
                              }
                              className={`transition-all duration-300 flex justify-start items-center gap-1 px-sm py-xs bg-menutabs-bg-default rounded-lg border border-solid border-white-100% ${
                                agentMap[
                                  taskAssigning.type as keyof typeof agentMap
                                ]?.borderColor
                              }`}
                            >
                              <Bot
                                className={`w-3 h-3 ${
                                  agentMap[
                                    taskAssigning.type as keyof typeof agentMap
                                  ]?.textColor
                                }`}
                              />
                              <div
                                className={`${
                                  agentMap[
                                    taskAssigning.type as keyof typeof agentMap
                                  ]?.textColor
                                } text-xs leading-17 font-medium`}
                              >
                                {taskAssigning.name}
                              </div>
                            </div>
                          )
          )}
              {/* bottom spacer to avoid content touching the viewport edge on scroll */}
              <div className="h-4" />
              </div>
                  </div>
                </div>
              ) : (
                ""
              );
            })}
          </div>
        ) : (
        // List
        <div className="p-6 flex flex-col justify-start items-center gap-4">
            {Object.keys(chatStore.tasks).map((taskId) => {
              const task = chatStore.tasks[taskId];
              return task.status != "finished" && !task.type ? (
                <div
                  key={taskId}
                  onClick={() => {
                    chatStore.setActiveTaskId(taskId);
                    navigate(`/`);
                  }}
                  className={`${
                    chatStore.activeTaskId === taskId ? "!bg-white-100%" : ""
                  } max-w-full relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-2xl flex justify-between items-center gap-md w-full p-3 h-14 shadow-history-item`}
                >
                  <div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-2xl pointer-events-none top-[-1px] left-[-1px] border-r-transparent"></div>
                  <div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-2xl pointer-events-none top-[-1px] right-[-1px] border-l-transparent"></div>
                  <img className="w-8 h-8" src={folderIcon} alt="folder-icon" />
                  <div className=" flex-1 text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis whitespace-nowrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span> {task.summaryTask || t("dashboard.new-project")}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p> {task.summaryTask || t("dashboard.new-project")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div
                    className={`px-3 h-full flex gap-sm border-[0px] border-solid ${
                      task.taskAssigning.length > 0 &&
                      "border-x border-white-100%"
                    }`}
                  >
                    {task.taskAssigning.map((taskAssigning) => (
                      <div
                        key={taskAssigning.agent_id}
                        aria-label="Toggle bold"
                        className="relative !w-10 !h-10 !p-2 rounded-sm hover:bg-white-100% transition-all duration-300"
                        onClick={() =>
                          handleClickAgent(
                            taskId,
                            taskAssigning.agent_id as AgentNameType
                          )
                        }
                      >
                        <Bot className="!h-6 !w-6" />
                        <div className="absolute top-[-2px] right-1">
                          {
                            agentIconMap[
                              taskAssigning.type as keyof typeof agentIconMap
                            ]
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[12px] leading-13 font-medium text-text-primary">
                    {task.taskRunning?.filter(
                      (taskItem) =>
                        taskItem.status === "completed" ||
                        taskItem.status === "failed"
                    ).length || 0}
                    /{task.taskRunning?.length || 0}
                  </div>
                  {(chatStore.tasks[taskId].status === "running" ||
                    chatStore.tasks[taskId].status === "pause") && (
                    <Button
                      variant={
                        chatStore.tasks[taskId].status === "pause"
                          ? "information"
                          : "cuation"
                      }
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTakeControl(
                          chatStore.tasks[taskId].status === "running"
                            ? "pause"
                            : "resume",
                          taskId
                        );
                      }}
                      className={`rounded-full `}
                    >
                      {chatStore.tasks[taskId].status === "pause" ? (
                        <CirclePlay />
                      ) : (
                        <CirclePause />
                      )}

                      <span className="text-text-inverse-primary text-xs font-semibold leading-17">
                        {chatStore.tasks[taskId].status === "pause"
                          ? t("layout.continue")
                          : t("layout.pause")}
                      </span>
                    </Button>
                  )}
                  {(chatStore.tasks[taskId].status === "pause" ||
                    chatStore.tasks[taskId].status === "pending") && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="icon"
                          onClick={(e) => e.stopPropagation()}
                          variant="ghost"
                        >
                          <Ellipsis size={16} className="text-text-primary" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className=" w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
                        <div className="space-y-1">
                          <PopoverClose asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(taskId);
                              }}
                            >
                              <Trash2
                                size={16}
                                className="text-icon-primary group-hover:text-icon-cuation"
                              />
                              {t("layout.delete")}
                            </Button>
                          </PopoverClose>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              ) : (
                ""
              );
            })}
        </div>
        )}
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="text-body-lg font-bold">{t("dashboard.project-archives")}</div>
          <div>
            {historyTasks.length === 0 && TABLE_VIEW_ENABLED && (
              <Tabs
                value={history_type}
                onValueChange={(value) =>
                  setHistoryType(value as "table" | "list")
                }
                defaultValue="list"
                className=""
              >
                <TabsList>
                  <TabsTrigger value="table">
                    <Table size={16} />
                    <div>{t("dashboard.table")}</div>
                  </TabsTrigger>
                  <TabsTrigger value="list">
                    <List size={16} />
                    <div>{t("dashboard.list")}</div>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
        </div>
        {TABLE_VIEW_ENABLED && history_type === "table" ? (
          // Table
          <div className="p-6 flex justify-start items-center flex-wrap gap-6">
            {historyTasks.map((task) => {
              return (
                <div
                  onClick={() => handleSetActive(task.task_id, task.question)}
                  key={task.task_id}
                  className={`${
                    chatStore.activeTaskId === task.task_id
                      ? "!bg-white-100%"
                      : ""
                  } relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-3xl flex justify-between items-center flex-wrap gap-md flex-initial w-[calc(33%-48px)] min-w-[300px] max-w-[500px] h-[180px] p-6 shadow-history-item border border-solid border-border-disabled`}
                >
                  <div
                    className="flex justify-between items-end gap-1 w-full"
                    style={{ marginBottom: "0.25rem" }}
                  >
                    <img
                      className="w-[60px] h-[60px] mt-6"
                      src={folderIcon}
                      alt="folder-icon"
                    />
                    <div className="flex justify-between items-end gap-1">
                      <Tag
                        variant="primary"
                        className="text-xs leading-17 font-medium text-nowrap"
                      >
                        {t("layout.token")} {task.tokens || 0}
                      </Tag>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-1 w-full">
                    <div className="text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis whitespace-nowrap">
                      {task?.question || t("dashboard.new-project")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        // List
        <div className="p-6 flex flex-col justify-start items-center gap-4 pb-40">
            {historyTasks.map((task) => {
              return (
                <div
                  onClick={() => {
                    handleSetActive(task.task_id, task.question);
                  }}
                  key={task.task_id}
                  className={`${
                    chatStore.activeTaskId === task.task_id
                      ? "!bg-white-100%"
                      : ""
                  } max-w-full relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-2xl flex justify-between items-center gap-md w-full p-3 h-14 shadow-history-item border border-solid border-border-disabled`}
                >
                  <div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-2xl pointer-events-none top-[-1px] left-[-1px] border-r-transparent"></div>
                  <div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-2xl pointer-events-none top-[-1px] right-[-1px] border-l-transparent"></div>
                  <img className="w-8 h-8" src={folderIcon} alt="folder-icon" />

                  <div className="w-full text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis whitespace-nowrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          {" "}
                          {task?.question.split("|")[0] || t("dashboard.new-project")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        align="start"
                        className="w-[800px] bg-white-100% p-2 text-wrap break-words text-xs select-text pointer-events-auto"
                      >
                        <div>
                          {" "}
                          {task?.question.split("|")[0] || t("dashboard.new-project")}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Tag
                    variant="primary"
                    className="text-xs leading-17 font-medium text-nowrap"
                  >
                    {t("layout.token")} {task.tokens || 0}
                  </Tag>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        size="icon"
                        onClick={(e) => e.stopPropagation()}
                        variant="ghost"
                      >
                        <Ellipsis size={16} className="text-text-primary" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className=" w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
                      <div className="space-y-1">
                        <PopoverClose asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShare(task.task_id);
                            }}
                          >
                            <Share size={16} />
                            {t("dashboard.share")}
                          </Button>
                        </PopoverClose>

                        <PopoverClose asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(task.id);
                            }}
                          >
                            <Trash2
                              size={16}
                              className="text-icon-primary group-hover:text-icon-cuation"
                            />
                            {t("dashboard.delete")}
                          </Button>
                        </PopoverClose>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
        </div>
        )}
      </div>

  );
}