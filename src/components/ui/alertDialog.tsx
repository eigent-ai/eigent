import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface ConfirmModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title?: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
}

export default function ConfirmModal({
	isOpen,
	onClose,
	onConfirm,
	title = "Confirm Title",
	message = "Confirm content?",
	confirmText = "Confirm",
	cancelText = "Cancel",
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
						className="fixed inset-0 bg-black/50 z-100 alert-dialog"
						onClick={onClose}
					/>

					{/* Modal */}
					<motion.div
						initial={{ opacity: 0, scale: 0.9, y: 20 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.9, y: 20 }}
						className="fixed max-w-md alert-dialog-wrapper rounded-xl backdrop-blur-xl  shadow-perfect"
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
									variant="cuation"
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
