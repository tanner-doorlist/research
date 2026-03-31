interface Props { viewType: string; children: React.ReactNode }

export function Shell({ children }: Props) {
  return (
    <div id="shell" className="fixed inset-0 overflow-hidden">
      <div className="glass absolute inset-0 pt-6 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
