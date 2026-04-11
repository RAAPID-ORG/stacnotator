import { type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

// Shared motion vocabulary. Keep transitions in the 120-220ms window.

export const softSpring = { type: 'spring', stiffness: 380, damping: 30, mass: 0.6 } as const;

export const softEase = [0.22, 1, 0.36, 1] as const;

export const dropdownVariants: Variants = {
  hidden: { opacity: 0, y: -4, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.14, ease: softEase } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1, ease: softEase } },
};

export const Dropdown = ({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) => (
  <AnimatePresence>
    {open && (
      <motion.div
        variants={dropdownVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);

export const dialogBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const dialogPanelVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: softSpring },
  exit: { opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.1 } },
};

export const pageFadeVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: softEase } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const FadeIn = ({ children, className }: { children: ReactNode; className?: string }) => (
  <motion.div variants={pageFadeVariants} initial="hidden" animate="visible" className={className}>
    {children}
  </motion.div>
);

export const listContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03, delayChildren: 0.04 },
  },
};

export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: softEase } },
};

export { motion, AnimatePresence };
