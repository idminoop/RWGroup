import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import React from 'react'

const headingVariants = cva(
  'font-bold tracking-tight text-slate-900 dark:text-white',
  {
    variants: {
      size: {
        h1: 'text-4xl md:text-5xl lg:text-6xl leading-tight',
        h2: 'text-3xl md:text-4xl leading-tight',
        h3: 'text-2xl md:text-3xl leading-snug',
        h4: 'text-xl md:text-2xl leading-snug',
        h5: 'text-lg md:text-xl leading-snug',
        h6: 'text-base md:text-lg font-semibold leading-normal',
      },
      weight: {
        default: '',
        light: 'font-light',
        normal: 'font-normal',
        medium: 'font-medium',
        semibold: 'font-semibold',
        bold: 'font-bold',
      }
    },
    defaultVariants: {
      size: 'h2',
      weight: 'default'
    }
  }
)

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement>, VariantProps<typeof headingVariants> {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}

export function Heading({ className, size, weight, as, ...props }: HeadingProps) {
  const Comp = as || (size || 'h2')
  return <Comp className={cn(headingVariants({ size, weight, className }))} {...props} />
}

const textVariants = cva(
  'text-slate-700 dark:text-slate-300',
  {
    variants: {
      size: {
        lg: 'text-lg leading-relaxed',
        base: 'text-base leading-relaxed',
        sm: 'text-sm leading-relaxed',
        xs: 'text-xs leading-normal',
      },
      weight: {
        light: 'font-light',
        normal: 'font-normal',
        medium: 'font-medium',
        semibold: 'font-semibold',
        bold: 'font-bold',
      },
      muted: {
        true: 'text-slate-500 dark:text-slate-400',
        false: ''
      }
    },
    defaultVariants: {
      size: 'base',
      weight: 'normal',
      muted: false
    }
  }
)

interface TextProps extends React.HTMLAttributes<HTMLParagraphElement>, VariantProps<typeof textVariants> {
  as?: 'p' | 'span' | 'div' | 'label'
}

export function Text({ className, size, weight, muted, as = 'p', ...props }: TextProps) {
  const Comp = as
  return <Comp className={cn(textVariants({ size, weight, muted, className }))} {...(props as any)} />
}
