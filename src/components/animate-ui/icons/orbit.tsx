'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type OrbitProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {
      initial: { rotate: 0 },
      animate: {
        rotate: 360,
        transition: {
          duration: 2,
          ease: 'linear',
          repeat: Infinity,
          repeatType: 'loop',
        },
      },
    },
    circle1: {},
    circle2: {},
    path1: {},
    path2: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: OrbitProps) {
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
      <motion.path
        d="M20.341 6.484A10 10 0 0 1 10.266 21.85"
        variants={variants.path1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M3.659 17.516A10 10 0 0 1 13.74 2.152"
        variants={variants.path2}
        initial="initial"
        animate={controls}
      />
      <motion.circle
        cx="12"
        cy="12"
        r="3"
        variants={variants.circle1}
        initial="initial"
        animate={controls}
      />
      <motion.circle
        cx="19"
        cy="5"
        r="2"
        variants={variants.circle2}
        initial="initial"
        animate={controls}
      />
      <motion.circle
        cx="5"
        cy="19"
        r="2"
        variants={variants.circle3}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Orbit(props: OrbitProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Orbit,
  Orbit as OrbitIcon,
  type OrbitProps,
  type OrbitProps as OrbitIconProps,
};
