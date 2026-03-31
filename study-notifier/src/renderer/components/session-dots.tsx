interface Props {
  done: number
  total: number
}

export function SessionDots({ done, total }: Props) {
  if (total <= 1) return null

  return (
    <div className="flex items-center gap-[var(--spacing-gap)] px-[var(--spacing-x)] pt-[var(--spacing-gap)] shrink-0">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-colors duration-300 ${
            i < done ? 'bg-success' : i === done ? 'bg-accent shadow-[0_0_6px_var(--color-accent-glow)]' : 'bg-white/15'
          }`}
        />
      ))}
      <span className="text-[11px] text-text-dim">
        {done + 1} of {total}
      </span>
    </div>
  )
}
