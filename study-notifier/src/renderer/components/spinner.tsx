import { cn } from '../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <div className={cn('w-4 h-4 border-2 border-white/10 border-t-accent rounded-full animate-spin', className)} />
}
