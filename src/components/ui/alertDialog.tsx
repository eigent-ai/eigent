import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "success" | "cuation" | "information" | "warning";

interface ConfirmModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title?: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
	confirmVariant?: ButtonVariant;
}

export default function ConfirmModal({
	isOpen,
	onClose,
	onConfirm,
	title = "Confirm Title",
	message = "Confirm content?",
	confirmText = "Confirm",
	cancelText = "Cancel",
	confirmVariant = "cuation",
}: ConfirmModalProps) {
	return (
		<AnimatePresence>
			{isOpen && (
				<>
					{/* Background overlay */}
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 bg-white/5 z-100 alert-dialog"
						onClick={onClose}
					/>

					{/* Modal */}
					<motion.div
						initial={{ opacity: 0, scale: 0.9, y: 20 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.9, y: 20 }}
						className="fixed max-w-md alert-dialog-wrapper rounded-xl  shadow-perfect"
					>
						<div className="p-6">
							<span className="text-body-lg font-bold text-text-primary mb-2">
								{title}
							</span>
							<p className="text-label-md text-text-label mb-6">{message}</p>

							<div className="flex justify-end gap-3">
								<Button variant="ghost" onClick={onClose}>
									{cancelText}
								</Button>
								<Button
									variant={confirmVariant}
									onClick={() => {
										onConfirm();
										onClose();
									}}
								>
									{confirmText}
								</Button>
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}
