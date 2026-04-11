import { type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

/**
 * Motion primitives for STACNotator. A small, restrained vocabulary of
 * easings and variants so every animated surface in the app moves the
 * same way - quiet, tactile, deliberate. No spinning, no flashy scale,
 * no 800ms slow-ins. Most things live in the 120-220ms window.
 */

/** Shared spring for pop-ins (dropdowns, modals, popovers). Quick settle,
 *  no overshoot, feels like paper landing on a desk. */
export const softSpring = { type: 'spring', stiffness: 380, damping: 30, mass: 0.6 } as const;

/** Tween ease for short fades. */
export const softEase = [0.22, 1, 0.36, 1] as const;

// ─── Dropdown / popover variants ──────────────────────────────────────────

export const dropdownVariants: Variants = {
  hidden: { opacity: 0, y: -4, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.14, ease: softEase } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1, ease: softEase } },
};

/** Small wrapper: use instead of conditionally rendering a dropdown panel
 *  directly. Handles enter + exit animation. Pass the panel JSX as children. */
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

// ─── Modal / dialog variants ──────────────────────────────────────────────

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

// ─── Route / content fade ────────────────────────────────────────────────

export const pageFadeVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: softEase } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Wrap a page's root content with this to get a quiet fade-in on mount.
 *  Meant for list/detail pages, not the annotator canvas (which is dense
 *  and shouldn't shimmy on every navigation). */
export const FadeIn = ({ children, className }: { children: ReactNode; className?: string }) => (
  <motion.div variants={pageFadeVariants} initial="hidden" animate="visible" className={className}>
    {children}
  </motion.div>
);

// ─── List row stagger ────────────────────────────────────────────────────

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
