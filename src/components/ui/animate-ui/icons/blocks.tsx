// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  IconWrapper,
  useAnimateIconContext,
  type IconProps,
} from '@/components/ui/animate-ui/icons/icon';

type BlocksProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    path1: {
      initial: {
        x: 0,
        y: 0,
        d: 'M10 22V7c0-.6-.4-1-1-1H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-5c0-.6-.4-1-1-1H2',
        strokeLinejoin: 'round',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      animate: {
        x: 2,
        y: -2,
        d: 'M10 22V6H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-6H2',
        strokeLinejoin: 'miter',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
          d: { duration: 0, delay: 0.3 },
          strokeLinejoin: { duration: 0, delay: 0.3 },
        },
      },
    },
    path2: {
      initial: {
        x: 0,
        y: 0,
        d: 'M15 2 H21 A1 1 0 0 1 22 3 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      animate: {
        x: -2,
        y: 2,
        d: 'M15 2 H20 A2 2 0 0 1 22 4 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
    },
  } satisfies Record<string, Variants>,
  'default-loop': {
    path1: {
      initial: {
        x: 0,
        y: 0,
        d: 'M10 22V7c0-.6-.4-1-1-1H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-5c0-.6-.4-1-1-1H2',
        strokeLinejoin: 'round',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      animate: {
        x: [0, 2, 0],
        y: [0, -2, 0],
        d: [
          'M10 22V7c0-.6-.4-1-1-1H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-5c0-.6-.4-1-1-1H2',
          'M10 22V6H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-6H2',
          'M10 22V7c0-.6-.4-1-1-1H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-5c0-.6-.4-1-1-1H2',
        ],
        strokeLinejoin: ['round', 'miter', 'round'],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
          d: { duration: 0, delay: 0.3 },
          strokeLinejoin: { duration: 0, delay: 0.3 },
        },
      },
    },
    path2: {
      initial: {
        x: 0,
        y: 0,
        d: 'M15 2 H21 A1 1 0 0 1 22 3 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      animate: {
        x: [0, -2, 0],
        y: [0, 2, 0],
        d: [
          'M15 2 H21 A1 1 0 0 1 22 3 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
          'M15 2 H20 A2 2 0 0 1 22 4 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
          'M15 2 H21 A1 1 0 0 1 22 3 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z',
        ],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BlocksProps) {
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
        d="M10 22V7c0-.6-.4-1-1-1H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-5c0-.6-.4-1-1-1H2"
        variants={variants.path1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M15 2 H21 A1 1 0 0 1 22 3 V9 A1 1 0 0 1 21 10 H15 A1 1 0 0 1 14 9 V3 A1 1 0 0 1 15 2 Z"
        variants={variants.path2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Blocks(props: BlocksProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Blocks,
  Blocks as BlocksIcon,
  type BlocksProps as BlocksIconProps,
  type BlocksProps,
};
