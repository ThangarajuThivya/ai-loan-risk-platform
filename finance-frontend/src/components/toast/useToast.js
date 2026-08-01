import { useToastContext } from "./ToastProvider";

export const useToast = () => {
  const context = useToastContext();

  if (!context) {
    throw new Error("useToast must be inside ToastProvider");
  }

  return context;
};
