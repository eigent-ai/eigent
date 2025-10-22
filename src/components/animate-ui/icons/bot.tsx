'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type BotProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    path1: {},
    rect: {},
    path2: {},
    path3: {},
    path4: {
      initial: {
        x: 0,
        y: 0,
      },
      animate: {
        x: [0, -1.5, 1.5, 0],
        y: [0, 1.5, 1.5, 0],
        transition: {
          ease: 'easeInOut',
          duration: 1.3,
        },
      },
    },
    path5: {
      initial: {
        x: 0,
        y: 0,
      },
      animate: {
        x: [0, -1.5, 1.5, 0],
        y: [0, 1.5, 1.5, 0],
        transition: {
          ease: 'easeInOut',
          duration: 1.3,
        },
      },
    },
  } satisfies Record<string, Variants>,
  blink: {
    path1: {},
    rect: {},
    path2: {},
    path3: {},
    path4: {
      initial: {
        scaleY: 1,
      },
      animate: {
        scaleY: [1, 0.5, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.6,
        },
      },
    },
    path5: {
      initial: {
        scaleY: 1,
      },
      animate: {
        scaleY: [1, 0.5, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.6,
        },
      },
    },
  } satisfies Record<string, Variants>,
  wink: {
    path1: {},
    rect: {},
    path2: {},
    path3: {},
    path4: {
      initial: {
        scaleY: 1,
      },
      animate: {
        scaleY: [1, 0.5, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.6,
        },
      },
    },
    path5: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BotProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.path
        d="M12 8V4H8"
        variants={variants.path1}
        initial="initial"
        animate={controls}
      />
      <motion.rect
        width={16}
        height={12}
        x={4}
        y={8}
        rx={2}
        variants={variants.rect}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M2 14h2"
        variants={variants.path2}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M20 14h2"
        variants={variants.path3}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M15 13v2"
        variants={variants.path4}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M9 13v2"
        variants={variants.path5}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Bot(props: BotProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Bot,
  Bot as BotIcon,
  type BotProps,
  type BotProps as BotIconProps,
};
