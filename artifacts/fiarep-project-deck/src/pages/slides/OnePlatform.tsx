export default function OnePlatform() {
  return (
    <div className="grid-bg relative w-screen h-screen overflow-hidden font-body text-text">
      <div className="absolute left-[5vw] top-[5vh] h-[3vw] w-[3vw] bg-primary" />
      <div className="absolute right-[5vw] top-[5vh] text-right text-[1.5vw] font-semibold uppercase tracking-[0.12em] text-primary">FIAREP / 02</div>
      <div className="absolute left-[10vw] top-[16vh] w-[80vw]">
        <h2 className="text-[4.2vw] font-bold leading-[1.08] tracking-[-0.035em] text-[#111111]">One platform for property operations</h2>
        <div className="mt-[5vh] grid grid-cols-2 gap-[2.5vw]">
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2.2vw]">
            <div className="mb-[1.7vh] h-[1.3vw] w-[1.3vw] bg-primary" />
            <p className="text-[2vw] font-medium leading-[1.35] text-[#334155]">Replace disconnected field notes, spreadsheets, messages, and manual handoffs</p>
          </div>
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2.2vw]">
            <div className="mb-[1.7vh] h-[1.3vw] w-[1.3vw] bg-accent" />
            <p className="text-[2vw] font-medium leading-[1.35] text-[#334155]">Capture inspections, estimates, repairs, projects, violations, and supporting files</p>
          </div>
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2.2vw]">
            <div className="mb-[1.7vh] h-[1.3vw] w-[1.3vw] bg-accent" />
            <p className="text-[2vw] font-medium leading-[1.35] text-[#334155]">Keep operational data synchronized across devices and management views</p>
          </div>
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2.2vw]">
            <div className="mb-[1.7vh] h-[1.3vw] w-[1.3vw] bg-warm" />
            <p className="text-[2vw] font-medium leading-[1.35] text-[#334155]">Preserve role authority while giving each audience the tools it needs</p>
          </div>
        </div>
      </div>
    </div>
  );
}
