import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

const selectVariants = cva(
  'flex h-10 w-full min-w-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-slate-900 ring-offset-background placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-slate-200 bg-white focus:ring-slate-400',
        error: 'border-red-500 focus:ring-red-500',
        ghost: 'border-none bg-transparent text-inherit placeholder:text-inherit/60 shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {
  error?: boolean
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, variant, error, ...props }, ref) => {
    return (
      <select
        className={cn(selectVariants({ variant: error ? 'error' : variant, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  }
)
Select.displayName = 'Select'

export { Select }
export default Select
