export default function Audiences() {
  return (
    <div className="grid-bg relative w-screen h-screen overflow-hidden font-body text-text">
      <div className="absolute left-[5vw] top-[5vh] h-[3vw] w-[3vw] bg-primary" />
      <div className="absolute right-[5vw] top-[5vh] text-right text-[1.5vw] font-semibold uppercase tracking-[0.12em] text-primary">FIAREP / 03</div>
      <div className="absolute left-[10vw] top-[14vh] w-[80vw]">
        <h2 className="max-w-[74vw] text-[4.2vw] font-bold leading-[1.08] tracking-[-0.035em] text-[#111111]">Purpose-built for every audience</h2>
        <div className="mt-[4.5vh] grid grid-cols-[0.95fr_1.05fr] border border-[#DDE2E7] bg-[#FCFCFB]/95">
          <div className="border-r border-[#DDE2E7] p-[2.3vw]">
            <div className="text-[1.5vw] font-bold uppercase tracking-[0.12em] text-primary">Field + Public</div>
            <p className="mt-[2.4vh] text-[2vw] font-semibold leading-[1.35] text-[#111827]">Mobile: inspectors, workers, supervisors, emergency teams, and other field staff</p>
            <div className="my-[2.6vh] h-px bg-[#DDE2E7]" />
            <p className="text-[2vw] font-semibold leading-[1.35] text-[#111827]">Public access: residents report issues by address; vendors use Procurement-issued scope codes</p>
          </div>
          <div className="p-[2.3vw]">
            <div className="text-[1.5vw] font-bold uppercase tracking-[0.12em] text-primary">Management + Platform</div>
            <p className="mt-[2.4vh] text-[2vw] font-semibold leading-[1.35] text-[#111827]">Management web: dashboards, projects, Resident reports, Calendar, Team, Leave, Elevators, and Change Orders</p>
            <div className="my-[2.6vh] h-px bg-[#DDE2E7]" />
            <p className="text-[2vw] font-semibold leading-[1.35] text-[#111827]">Platform Control: organization licensing, staff limits, development limits, and connected-development usage</p>
          </div>
        </div>
      </div>
    </div>
  );
}
