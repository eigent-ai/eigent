import { useCallback } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";

interface Props {
    open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger?: React.ReactNode;
}
export default function CloseNoticeDialog({open, onOpenChange, trigger}: Props)  {

    const onSubmit = useCallback(() => {
        window.electronAPI.closeWindow(true)
    }, [])

    return <Dialog open={open} onOpenChange={onOpenChange}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent className="sm:max-w-[600px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm">
            <DialogHeader className="!bg-popup-surface !rounded-t-xl p-md">
                <DialogTitle className="m-0">
                    Close notice
                </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-md bg-popup-bg p-md">
                A task is currently running. Exiting will terminate it. Are you sure you want to exit?
            </div>
             <DialogFooter className="bg-white-100% !rounded-b-xl p-md">
                <DialogClose asChild>
                    <Button variant="ghost" size="md">
                        Cancel
                    </Button>
                </DialogClose>
                <Button size="md" onClick={onSubmit} variant="primary">
                    Yes
                </Button>            
            </DialogFooter>
        </DialogContent>
    </Dialog>
}