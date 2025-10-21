import { ChevronDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskType } from "./TaskType";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";

export const TypeCardSkeleton = ({
	isTakeControl,
}: {
	isTakeControl: boolean;
}) => {
	const { t } = useTranslation();
	return (
		<div>
			<div className="w-full h-auto flex flex-col gap-2 px-2 py-sm transition-all duration-300 ">
				<div className="w-full h-auto bg-task-surface backdrop-blur-[5px] rounded-xl py-sm relative overflow-hidden">
					<div className="absolute top-0 left-0 w-full bg-transparent">
						<Progress value={100} className="h-[2px] w-full" />
					</div>
					<div className="text-sm font-bold leading-13 mb-2.5 px-sm flex flex-col gap-sm">
						<div
							className={`bg-fill-skeloten-default w-full rounded-full h-5  ${
								!isTakeControl ? "animate-pulse" : ""
							}`}
						></div>
						<div
							className={`bg-fill-skeloten-default w-1/2 rounded-full h-5  ${
								!isTakeControl ? "animate-pulse" : ""
							}`}
						></div>
						<div
							className={`bg-fill-skeloten-default w-1/2 rounded-full h-5  ${
								!isTakeControl ? "animate-pulse" : ""
							}`}
						></div>
					</div>

					<div className={`flex items-center justify-between gap-2 px-sm`}>
						<div className="flex items-center gap-2 ">
							<TaskType type={1} />
						</div>

						<div className="transition-all duration-300 ease-in-out">
							<div className="flex items-center gap-2 animate-in fade-in-0 slide-in-from-right-2 duration-300">
								<div className="text-text-tertiary text-xs font-medium leading-17">
									{t("layout.tasks")}
								</div>
								<Button variant="ghost" size="icon">
									<ChevronDown
										size={16}
										className={`transition-transform duration-300 rotate-180`}
									/>
								</Button>
							</div>
						</div>
					</div>
					<div className="relative">
						<div className="overflow-hidden transition-all duration-300 ease-in-out">
							<div className="mt-sm flex flex-col px-2 gap-2">
								{[1, 2, 3, 4].map((task: number) => {
									return (
										<div
											key={`taskList-${task}`}
											className={`rounded-lg flex gap-2 py-sm px-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 bg-task-fill-default border border-solid border-transparent cursor-pointer
											`}
										>
											<div className="pt-0.5">
												<LoaderCircle
													size={16}
													className={`text-icon-success ${
														!isTakeControl ? "animate-spin" : ""
													}`}
												/>
											</div>
											<div className="flex-1 flex flex-col items-start justify-center gap-sm">
												<div
													className={` w-full text-sm font-medium leading-13 bg-fill-skeloten-default rounded-full h-5 ${
														!isTakeControl ? "animate-pulse" : ""
													}`}
												></div>
												<div
													className={` w-1/3 text-sm font-medium leading-13 bg-fill-skeloten-default rounded-full h-5 ${
														!isTakeControl ? "animate-pulse" : ""
													}`}
												></div>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
