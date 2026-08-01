import { AnimatePresence } from "framer-motion";
import Toast from "./Toast";

const positions = {
  "top-right": "top-5 right-5",

  "top-left": "top-5 left-5",

  "bottom-right": "bottom-5 right-5",

  "bottom-left": "bottom-5 left-5",

  "top-center": "top-5 left-1/2 -translate-x-1/2",

  "bottom-center": "bottom-5 left-1/2 -translate-x-1/2",
};

const ToastContainer = ({ toasts, removeToast, position }) => {
  return (
    <div
      className={`
fixed z-[9999]
flex flex-col gap-3
${positions[position]}
`}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} removeToast={removeToast} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
