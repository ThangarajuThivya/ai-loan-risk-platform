import { createContext, useContext, useState } from "react";
import ToastContainer from "./ToastContainer";

const ToastContext = createContext();

export const ToastProvider = ({ children, position = "top-right" }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showToast = ({ type = "info", title, message }) => {
    const id = Date.now();

    const newToast = {
      id,
      type,
      title,
      message,
      createdAt: new Date().toLocaleTimeString(),
    };

    setToasts((prev) => {
      const updated = [...prev, newToast];

      return updated.slice(-5);
    });

    setTimeout(() => {
      removeToast(id);
    }, 5000);
  };

  return (
    <ToastContext.Provider
      value={{
        showToast,
        removeToast,
      }}
    >
      {children}

      <ToastContainer
        toasts={toasts}
        removeToast={removeToast}
        position={position}
      />
    </ToastContext.Provider>
  );
};

export const useToastContext = () => useContext(ToastContext);
