import { motion } from "framer-motion";

import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

const config = {
  success: {
    icon: <CheckCircle />,
    color: "border-green-500",
  },

  error: {
    icon: <XCircle />,
    color: "border-red-500",
  },

  warning: {
    icon: <AlertTriangle />,
    color: "border-yellow-500",
  },

  info: {
    icon: <Info />,
    color: "border-blue-500",
  },
};

const Toast = ({ toast, removeToast }) => {
  const item = config[toast.type];

  return (
    <motion.div
      initial={{
        opacity: 0,
        x: 100,
        scale: 0.8,
      }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1,
      }}
      exit={{
        opacity: 0,
        x: 100,
        scale: 0.8,
      }}
      transition={{
        type: "spring",
        duration: 0.5,
      }}
      whileHover={{
        scale: 1.03,
      }}
      className={`
w-[350px]
rounded-2xl
border-l-4
${item.color}

bg-white/80
backdrop-blur-xl

shadow-xl

p-4
relative
overflow-hidden

dark:bg-gray-900/80

`}
    >
      <div
        className="
flex
gap-3
items-start
"
      >
        <div
          className="
text-xl
"
        >
          {item.icon}
        </div>

        <div
          className="
flex-1
"
        >
          <h3
            className="
font-semibold
text-gray-800
dark:text-white
"
          >
            {toast.title}
          </h3>

          <p
            className="
text-sm
text-gray-600
dark:text-gray-300
"
          >
            {toast.message}
          </p>

          <p
            className="
text-xs
mt-1
text-gray-400
"
          >
            {toast.createdAt}
          </p>
        </div>

        <button
          onClick={() => removeToast(toast.id)}
          className="
text-gray-400
hover:text-red-500
"
        >
          <X size={18} />
        </button>
      </div>

      <motion.div
        initial={{
          width: "100%",
        }}
        animate={{
          width: "0%",
        }}
        transition={{
          duration: 5,
          ease: "linear",
        }}
        className="
absolute
bottom-0
left-0
h-1
bg-blue-500
"
      />
    </motion.div>
  );
};

export default Toast;
