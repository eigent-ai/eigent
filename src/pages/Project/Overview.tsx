import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListTodo, Zap, Bot, FileText, Calendar, TrendingUp, Users, CheckCircle2, Activity, ExternalLink, Bell, ChevronDown, Filter, MoreHorizontal, Share2, Edit, Trash2, User, Coins, Pin, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Mock data - replace with actual data from your store
const projectStats = {
    totalTasks: 8,
    tasksWithTrigger: 3,
    numberOfAgents: 5,
    recentFiles: [
        { name: "report_analysis.pdf", path: "/documents/report_analysis.pdf" },
        { name: "user_data.json", path: "/data/user_data.json" },
        { name: "summary.md", path: "/notes/summary.md" }
    ]
};

// Mock notifications data for the live stream
const liveNotifications = [
    {
        id: 1,
        type: "success",
        message: "Task 'API Integration' completed successfully",
        timestamp: "Just now",
        icon: CheckCircle2
    },
    {
        id: 2,
        type: "info",
        message: "Agent 'DataProcessor' started new task",
        timestamp: "2 min ago",
        icon: Bot
    },
    {
        id: 3,
        type: "warning",
        message: "Trigger 'Daily Report' scheduled for 6:00 PM",
        timestamp: "5 min ago",
        icon: Zap
    },
    {
        id: 4,
        type: "info",
        message: "New file 'analysis_v2.pdf' generated",
        timestamp: "12 min ago",
        icon: FileText
    },
    {
        id: 5,
        type: "success",
        message: "Database sync completed",
        timestamp: "15 min ago",
        icon: Activity
    }
];

const getNotificationStyles = (type: string) => {
    switch (type) {
        case "success":
            return "border-l-emerald-500 bg-emerald-500/5";
        case "warning":
            return "border-l-amber-500 bg-amber-500/5";
        case "error":
            return "border-l-red-500 bg-red-500/5";
        default:
            return "border-l-blue-500 bg-blue-500/5";
    }
};

const getNotificationIconColor = (type: string) => {
    switch (type) {
        case "success":
            return "text-emerald-500";
        case "warning":
            return "text-amber-500";
        case "error":
            return "text-red-500";
        default:
            return "text-blue-500";
    }
};

// Mock data for the list view
const recentItems = [
    {
        id: 1,
        title: "API Integration Complete",
        description: "Successfully integrated the payment gateway API",
        status: "completed",
        taskType: "triggered",
        tokens: 1250,
        date: "2 hours ago",
        icon: CheckCircle2
    },
    {
        id: 2,
        title: "Database Migration",
        description: "Migrating user data to new schema",
        status: "in-progress",
        taskType: "manual",
        tokens: 890,
        date: "4 hours ago",
        icon: Activity
    },
    {
        id: 3,
        title: "UI Component Library",
        description: "Building reusable component library",
        status: "in-progress",
        taskType: "manual",
        tokens: 2100,
        date: "Yesterday",
        icon: FileText
    },
    {
        id: 4,
        title: "Performance Optimization",
        description: "Optimizing database queries for faster load times",
        status: "pending",
        taskType: "triggered",
        tokens: 450,
        date: "Yesterday",
        icon: TrendingUp
    },
    {
        id: 5,
        title: "Team Onboarding",
        description: "New team member documentation and setup",
        status: "completed",
        taskType: "triggered",
        tokens: 3200,
        date: "2 days ago",
        icon: Users
    },
    {
        id: 6,
        title: "Sprint Planning",
        description: "Q4 sprint planning and task allocation",
        status: "pending",
        taskType: "manual",
        tokens: 780,
        date: "3 days ago",
        icon: Calendar
    }
];

const getStatusStyles = (status: string) => {
    switch (status) {
        case "completed":
            return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
        case "in-progress":
            return "bg-blue-500/10 text-blue-600 border-blue-500/20";
        case "pending":
            return "bg-amber-500/10 text-amber-600 border-amber-500/20";
        default:
            return "bg-gray-500/10 text-gray-600 border-gray-500/20";
    }
};

const getStatusLabel = (status: string) => {
    switch (status) {
        case "completed":
            return "Completed";
        case "in-progress":
            return "In Progress";
        case "pending":
            return "Pending";
        default:
            return status;
    }
};

export default function Overview() {
    const [taskFilter, setTaskFilter] = useState<"all" | "triggered" | "manual">("all");

    const filteredItems = recentItems.filter((item) => {
        if (taskFilter === "all") return true;
        return item.taskType === taskFilter;
    });

    const getFilterLabel = () => {
        switch (taskFilter) {
            case "triggered":
                return "Triggered Tasks";
            case "manual":
                return "Manual Tasks";
            default:
                return "All Tasks";
        }
    };

    return (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full">
            <div className="bg-surface-secondary px-4 py-2">
                {/* Bento Grid - 50/50 Split Layout */}
                <div className="grid grid-cols-2 gap-4 w-full">
                    {/* Left Side: 4 Stat Cards in 2x2 Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Card 1: Number of Tasks */}
                        <Card className="bg-surface-tertiary border-0 shadow-sm">
                            <CardContent className="flex-1 flex h-full items-center gap-4 p-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                                    <ListTodo className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-body-xs font-medium text-text-label">Total Tasks</span>
                                    <span className="text-body-lg font-bold text-text-heading">{projectStats.totalTasks}</span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card 2: Tasks with Trigger */}
                        <Card className="bg-surface-tertiary border-0 shadow-sm">
                            <CardContent className="flex-1 flex h-full items-center gap-4 p-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                                    <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-body-xs font-medium text-text-label">Triggered Tasks</span>
                                    <span className="text-body-lg font-bold text-text-heading">{projectStats.tasksWithTrigger}</span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card 3: Number of Agents */}
                        <Card className="bg-surface-tertiary border-0 shadow-sm">
                            <CardContent className="flex-1 flex h-full items-center gap-4 p-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
                                    <Bot className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-body-xs font-medium text-text-label">Agents</span>
                                    <span className="text-body-lg font-bold text-text-heading">{projectStats.numberOfAgents}</span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card 4: Recent Files Count */}
                        <Card className="bg-surface-tertiary border-0 shadow-sm">
                            <CardContent className="flex-1 flex h-full items-center gap-4 p-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                                    <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-body-xs font-medium text-text-label">Recent Files</span>
                                    <span className="text-body-lg font-bold text-text-heading">{projectStats.recentFiles.length}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Side: Live Notifications Stream */}
                    <Card className="relative overflow-hidden bg-surface-tertiary border-0 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between p-4">
                            <div className="flex items-center gap-2">
                                <div className="relative flex item-center">
                                    <Bell className="h-4 w-4 text-text-action" />
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                </div>
                                <CardTitle className="!text-label-sm font-bold text-text-heading">
                                    Live Activity
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 max-h-[160px] overflow-y-auto scrollbar">
                            <div className="divide-y divide-border-tertiary">
                                {liveNotifications.map((notification, index) => (
                                    <div
                                        key={notification.id}
                                        className={`flex items-center gap-2.5 px-4 py-1 border-l-2 transition-all duration-300 hover:bg-surface-tertiary-hover ${getNotificationStyles(notification.type)}`}
                                        style={{ animationDelay: `${index * 100}ms` }}
                                    >
                                        <notification.icon className={`h-4 w-4 flex-shrink-0 ${getNotificationIconColor(notification.type)}`} />
                                        <div className="flex flex-row w-full justify-between items-center min-w-0">
                                            <span className="text-label-xs text-text-body leading-relaxed">
                                                {notification.message}
                                            </span>
                                            <span className="text-label-xs text-text-label">
                                                {notification.timestamp}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                        <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-50 blur-2xl" />
                    </Card>
                </div>
            </div>
            <div className="flex-1 overflow-auto scrollbar mt-4 border-solid border-border-secondary border-[0.5px] border-x-0 border-b-0">
                {/* Sticky Header */}
                <div className="sticky top-0 z-10 bg-surface-secondary flex items-center justify-between py-4 pl-8 pr-3">
                    <div className="text-md font-semibold text-text-heading">Task History</div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-2">
                                <Filter className="h-4 w-4" />
                                {getFilterLabel()}
                                <ChevronDown className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setTaskFilter("all")}>
                                All Tasks
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTaskFilter("triggered")}>
                                Triggered Tasks
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTaskFilter("manual")}>
                                Manual Tasks
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* List View Section */}
                <div className="flex flex-col pl-4 pr-3 pb-4">
                    <div className="space-y-3">
                        {filteredItems.map((item) => (
                            <div
                                key={item.id}
                                className="group flex items-center gap-2 p-3 bg-surface-tertiary rounded-xl border border-border-tertiary hover:border-border-secondary hover:bg-surface-tertiary-hover transition-all duration-200 cursor-pointer"
                            >
                                {/* User Icon */}
                                <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
                                    <Pin className="w-4 h-4 text-white" />
                                </div>

                                {/* Task Prompt */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-text-body truncate group-hover:text-text-heading transition-colors">
                                        {item.title}
                                    </div>
                                    <div className="text-xs text-text-label truncate">
                                        {item.description}
                                    </div>
                                </div>

                                {/* Status Badge */}
                                <div className={`flex min-w-20 px-2 py-1 rounded-full text-xs font-medium border ${getStatusStyles(item.status)}`}>
                                    {getStatusLabel(item.status)}
                                </div>

                                {/* Trigger Badge */}
                                <div className={`flex min-w-20 item-center justify-center px-2 py-1 rounded-full text-xs font-medium ${item.taskType === "triggered" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" : "bg-slate-500/10 text-slate-600 border border-slate-500/20"}`}>
                                    {item.taskType === "triggered" ? "Triggered" : "Manual"}
                                </div>

                                {/* Token Count */}
                                <div className="flex min-w-20 flex items-center gap-1 text-xs text-text-label">
                                    <Coins className="w-3.5 h-3.5" />
                                    <span>{item.tokens.toLocaleString()}</span>
                                </div>

                                {/* More Button */}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center">
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem className="gap-2">
                                            <Share />
                                            Share
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="gap-2">
                                            <Edit />
                                            Re-edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600">
                                            <Trash2 />
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
