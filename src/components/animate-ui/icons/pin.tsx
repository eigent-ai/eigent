'use client';

import * as React from 'react';
import { motion, Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type PinProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {
      initial: {
        scale: 1,
        rotate: 0,
        x: 0,
        y: 0,
        transformOrigin: 'bottom center',
      },
      animate: {
        scale: [1, 0.75, 1, 1],
        rotate: [0, 30, -15, 0],
        x: [0, 0, 0, 0],
        y: [0, -6, 0, 0],
        transformOrigin: 'bottom center',
        transition: { ease: 'easeInOut', duration: 1 },
      },
    },
    line: {},
    path: {},
  } satisfies Record<string, Variants>,
  wiggle: {
    group: {
      initial: {
        rotate: 0,
        transformOrigin: 'bottom center',
      },
      animate: {
        rotate: [0, 15, -10, 0],
        transformOrigin: 'bottom center',
        transition: { ease: 'easeInOut', duration: 1 },
      },
    },
    line: {},
    path: {},
  } satisfies Record<string, Variants>,
  rotate: {
    group: {
      initial: {
        transform: 'rotate3d(0, 1, 0, 0deg)',
        perspective: 600,
      },
      animate: {
        transform: 'rotate3d(0, 1, 0, 360deg)',
        perspective: 600,
        transition: { ease: 'easeInOut', duration: 0.7 },
      },
    },
    line: {},
    path: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: PinProps) {
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
      <motion.g variants={variants.group} initial="initial" animate={controls}>
        <motion.line
          x1={12}
          y1={17.1}
          x2={12}
          y2={22}
          variants={variants.line}
          initial="initial"
          animate={controls}
        />
        <motion.path
          d="M9,10.8c0,.8-.4,1.5-1.1,1.8l-1.8.9c-.7.3-1.1,1-1.1,1.8v.8c0,.6.4,1,1,1h12c.6,0,1-.4,1-1v-.8c0-.8-.4-1.5-1.1-1.8l-1.8-.9c-.7-.3-1.1-1-1.1-1.8v-3.8c0-.6.4-1,1-1,1.1,0,2-.9,2-2s-.9-2-2-2h-8c-1.1,0-2,.9-2,2s.9,2,2,2,1,.4,1,1v3.8Z"
          variants={variants.path}
          initial="initial"
          animate={controls}
        />
      </motion.g>
    </motion.svg>
  );
}

function Pin(props: PinProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Pin,
  Pin as PinIcon,
  type PinProps,
  type PinProps as PinIconProps,
};
