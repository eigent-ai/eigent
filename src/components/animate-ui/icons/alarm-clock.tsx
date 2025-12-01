'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type AlarmClockProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {
      initial: {
        x: 0,
        y: 0,
      },
      animate: {
        x: [
          0,
          '2%',
          '-2%',
          '2%',
          '-2%',
          '2%',
          '-2%',
          '2%',
          '-2%',
          '2%',
          '-2%',
          0,
        ],
        y: [
          0,
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          '-5%',
          0,
        ],
        transition: {
          ease: 'easeInOut',
          duration: 0.6,
        },
      },
    },
    circle: {},
    line1: {
      initial: {
        rotate: 0,
      },
      animate: {
        transformOrigin: 'bottom left',
        rotate: [0, 5, -5, 5, -5, 5, -5, 5, -5, 5, -5, 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    line2: {
      initial: {
        rotate: 0,
      },
      animate: {
        transformOrigin: 'top left',
        rotate: [0, 5, -5, 5, -5, 5, -5, 5, -5, 5, -5, 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    path1: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    path2: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    path3: {},
    path4: {},
  } satisfies Record<string, Variants>,
  'default-loop': {
    group: {
      initial: {
        x: 0,
        y: 0,
      },
      animate: {
        x: ['2%', '-2%', '2%', '-2%', '2%', '-2%', '2%', '-2%', '2%', '-2%'],
        y: '-5%',
        transition: {
          duration: 0.5,
          x: {
            repeat: Infinity,
            repeatType: 'loop',
          },
          y: {
            duration: 0.2,
          },
        },
      },
    },
    circle: {},
    line1: {
      initial: {
        rotate: 0,
      },
      animate: {
        transformOrigin: 'bottom left',
        rotate: [0, 10, -10, 10, -10, 10, -10, 10, -10, 10, -10, 0],
        transition: { duration: 0.5, repeat: Infinity, repeatType: 'loop' },
      },
    },
    line2: {
      initial: {
        rotate: 0,
      },
      animate: {
        transformOrigin: 'top left',
        rotate: [0, 10, -10, 10, -10, 10, -10, 10, -10, 10, -10, 0],
        transition: { duration: 0.5, repeat: Infinity, repeatType: 'loop' },
      },
    },
    path1: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 0],
        transition: { duration: 0.5, repeat: Infinity, repeatType: 'loop' },
      },
    },
    path2: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 0],
        transition: { duration: 0.5, repeat: Infinity, repeatType: 'loop' },
      },
    },
    path3: {},
    path4: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: AlarmClockProps) {
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
      variants={variants.group}
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.circle
        cx={12}
        cy={13}
        r={8}
        variants={variants.circle}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={12}
        y1={9}
        x2={12}
        y2={13}
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={14}
        y1={15}
        x2={12}
        y2={13}
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M5 3 2 6"
        variants={variants.path1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m22 6-3-3"
        variants={variants.path2}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M6.38 18.7 4 21"
        variants={variants.path3}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M17.64 18.67 20 21"
        variants={variants.path4}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function AlarmClock(props: AlarmClockProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  AlarmClock,
  AlarmClock as AlarmClockIcon,
  type AlarmClockProps,
  type AlarmClockProps as AlarmClockIconProps,
};
