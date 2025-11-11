'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type CompassProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    path: {
      initial: {
        rotate: 0,
      },
      animate: {
        rotate: [0, 95, 75],
        transition: {
          duration: 0.7,
          ease: 'easeInOut',
        },
      },
    },
    circle: {},
  } satisfies Record<string, Variants>,
  'default-loop': {
    path: {
      initial: {
        rotate: 0,
      },
      animate: {
        rotate: [0, 95, 75, -20, 0],
        transition: {
          duration: 1.4,
          ease: 'easeInOut',
        },
      },
    },
    circle: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: CompassProps) {
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
        d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
      <motion.circle
        cx={12}
        cy={12}
        r={10}
        variants={variants.circle}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Compass(props: CompassProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Compass,
  Compass as CompassIcon,
  type CompassProps,
  type CompassProps as CompassIconProps,
};