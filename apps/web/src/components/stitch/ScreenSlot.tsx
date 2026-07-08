type ScreenSlotProps = {
  screen: string;
  description?: string;
};

/**
 * Placeholder for a screen that will come from Google Stitch.
 *
 * Import the generated screen (via the Stitch MCP `screen_to_react` tool, or by
 * pasting Stitch's React + Tailwind export) into this `stitch/` directory, then
 * replace the <ScreenSlot /> on the matching route with that component.
 */
export function ScreenSlot({ screen, description }: ScreenSlotProps) {
  return (
    <div className="mx-auto my-8 flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-3 border-[2px] border-dashed border-white p-8 text-center text-white">
      <p className="font-label-caps text-label-caps uppercase tracking-widest">Stitch screen slot</p>
      <p className="font-headline-sm text-headline-sm">{screen}</p>
      {description ? <p className="max-w-md font-body-md text-body-md">{description}</p> : null}
      <p className="font-data-mono text-data-mono">
        Import this screen from Google Stitch into <code className="mx-1">src/components/stitch/</code>
        and replace this slot.
      </p>
    </div>
  );
}
