import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cpu, Zap, Activity, Radio, AlertOctagon, CheckCircle2, ToggleLeft, ToggleRight } from 'lucide-react'

export function PlcDiagnostics() {
  // Live PLC I/O Toggle State
  const [i00_start, setI00_start] = useState(true)
  const [i01_eStop, setI01_eStop] = useState(true) // Normally Closed contact
  const [i02_jigSensor, setI02_jigSensor] = useState(true)
  const [i03_doorSafety, setI03_doorSafety] = useState(true)

  // Calculated Ladder Logic Outputs
  const q00_conveyor = i00_start && i01_eStop && i03_doorSafety
  const q02_redTower = !i01_eStop || !i03_doorSafety
  const q03_greenTower = q00_conveyor && !q02_redTower

  return (
    <Card className='border-primary/30 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='pb-3 flex flex-row items-center justify-between'>
        <div>
          <CardTitle className='text-lg font-bold flex items-center gap-2'>
            <Cpu className='h-5 w-5 text-blue-400' />
            Mô Phỏng PLC Siemens SIMATIC S7-1200 & Logic Sơ Đồ Thang (TIA Portal V16)
          </CardTitle>
          <CardDescription>
            Trực quan hóa cấu trúc phần cứng I/O Rack CPU 1212C, bảng đèn LED tín hiệu và chương trình Ladder Diagram
          </CardDescription>
        </div>

        <Badge variant='outline' className='bg-blue-500/10 text-blue-400 border-blue-500/30 font-mono text-xs gap-1.5 py-1'>
          <Radio className='h-3 w-3 animate-pulse' /> PROFINET PN/IE Online
        </Badge>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {/* Main Workspace: Left PLC Rack & LED Status, Right Ladder Logic Diagram */}
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          {/* Siemens S7-1200 PLC Hardware Rack Graphic */}
          <div className='space-y-4'>
            <div className='p-4 rounded-xl bg-slate-900 border-2 border-slate-700 shadow-xl space-y-4'>
              {/* PLC Top Header Logo */}
              <div className='flex items-center justify-between border-b border-slate-800 pb-2'>
                <span className='text-xs font-black tracking-widest text-slate-300 uppercase font-mono'>SIEMENS</span>
                <span className='text-[10px] font-mono text-slate-400'>SIMATIC S7-1200 CPU 1212C</span>
              </div>

              {/* Hardware Modules Grid */}
              <div className='grid grid-cols-4 gap-2 text-center text-[10px] font-mono'>
                {/* CPU Module */}
                <div className='col-span-2 p-2.5 rounded bg-slate-800 border border-slate-700 space-y-2'>
                  <div className='font-bold text-slate-200 text-xs'>CPU 1212C</div>
                  <div className='text-[9px] text-emerald-400 font-semibold'>RUN / STOP: RUN</div>
                  <div className='flex justify-center gap-1.5 pt-1'>
                    <span className='h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]' />
                    <span className='h-2 w-2 rounded-full bg-slate-700' />
                    <span className='h-2 w-2 rounded-full bg-slate-700' />
                  </div>
                </div>

                {/* Digital Input DI Module */}
                <div className='p-2 rounded bg-slate-850 border border-slate-750 space-y-1'>
                  <div className='font-bold text-slate-300'>DI 8x24V</div>
                  <div className='text-[8px] text-slate-400'>Inputs</div>
                  <div className='grid grid-cols-2 gap-1 pt-1'>
                    <div className={`h-2 rounded-full ${i00_start ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-700'}`} />
                    <div className={`h-2 rounded-full ${i01_eStop ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-700'}`} />
                    <div className={`h-2 rounded-full ${i02_jigSensor ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-700'}`} />
                    <div className={`h-2 rounded-full ${i03_doorSafety ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-700'}`} />
                  </div>
                </div>

                {/* Analog Module AI 4x13BIT (Matching Internship Report Table 1/2!) */}
                <div className='p-2 rounded bg-slate-850 border border-slate-750 space-y-1'>
                  <div className='font-bold text-slate-300'>AI 4x13BIT</div>
                  <div className='text-[8px] text-slate-400'>Analog</div>
                  <div className='text-[9px] text-amber-400 font-bold pt-2'>0-10V</div>
                </div>
              </div>
            </div>

            {/* Interactive Inputs Toggle Panel */}
            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2.5 text-xs'>
              <span className='font-semibold text-muted-foreground uppercase tracking-wider block text-[11px]'>
                🎛️ Bảng Thao Tác Tín Hiệu Đầu Vào (Digital Inputs)
              </span>

              <div className='flex items-center justify-between'>
                <span>I0.0 — Nút Bấm Khởi Động (Start):</span>
                <Button
                  size='sm'
                  variant={i00_start ? 'default' : 'outline'}
                  className='h-6 text-[10px] px-2'
                  onClick={() => setI00_start(!i00_start)}
                >
                  {i00_start ? 'Tín hiệu ON (24V)' : 'Tín hiệu OFF (0V)'}
                </Button>
              </div>

              <div className='flex items-center justify-between'>
                <span>I0.1 — Nút Dừng Khẩn Cấp (NC E-Stop):</span>
                <Button
                  size='sm'
                  variant={i01_eStop ? 'default' : 'destructive'}
                  className='h-6 text-[10px] px-2'
                  onClick={() => setI01_eStop(!i01_eStop)}
                >
                  {i01_eStop ? 'Bình Thường (Closed)' : 'Bấm Khẩn Cấp (Open)'}
                </Button>
              </div>

              <div className='flex items-center justify-between'>
                <span>I0.3 — Cảm Biến Cửa An Toàn (Safety Door):</span>
                <Button
                  size='sm'
                  variant={i03_doorSafety ? 'default' : 'outline'}
                  className='h-6 text-[10px] px-2'
                  onClick={() => setI03_doorSafety(!i03_doorSafety)}
                >
                  {i03_doorSafety ? 'Đã Đóng Cửa (Safe)' : 'Cửa Đang Mở (Unsafe)'}
                </Button>
              </div>
            </div>
          </div>

          {/* Right Workspace: Live Ladder Logic Viewer (Sơ đồ thang TIA Portal) */}
          <div className='lg:col-span-2 space-y-4'>
            <div className='p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-xl space-y-4'>
              <div className='flex items-center justify-between border-b border-slate-800 pb-2 text-xs font-mono text-slate-400'>
                <span>PROGRAM BLOCKS ➔ Main [OB1] (Ladder Diagram)</span>
                <span>Language: LAD</span>
              </div>

              {/* Ladder Network 1: Conveyor Control */}
              <div className='space-y-2'>
                <span className='text-xs font-mono font-bold text-amber-400 block'>
                  Network 1: Điều khiển Động Cơ Băng Tải (Conveyor Control)
                </span>

                <div className='relative p-4 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs overflow-x-auto flex items-center gap-3'>
                  {/* Left Power Rail */}
                  <div className='w-1.5 h-12 bg-emerald-500 rounded' />

                  {/* Contact I0.0 */}
                  <div className={`px-2 py-1.5 rounded border text-center ${i00_start ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold' : 'border-slate-700 text-slate-500'}`}>
                    <div>[ | ] I0.0</div>
                    <div className='text-[9px] opacity-80'>Start_Btn</div>
                  </div>

                  <span className={`h-0.5 w-6 ${i00_start ? 'bg-emerald-400' : 'bg-slate-700'}`} />

                  {/* Contact I0.1 E-Stop */}
                  <div className={`px-2 py-1.5 rounded border text-center ${i01_eStop ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold' : 'border-slate-700 text-slate-500'}`}>
                    <div>[ / ] I0.1</div>
                    <div className='text-[9px] opacity-80'>E_Stop</div>
                  </div>

                  <span className={`h-0.5 w-6 ${i00_start && i01_eStop ? 'bg-emerald-400' : 'bg-slate-700'}`} />

                  {/* Contact I0.3 Door */}
                  <div className={`px-2 py-1.5 rounded border text-center ${i03_doorSafety ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold' : 'border-slate-700 text-slate-500'}`}>
                    <div>[ | ] I0.3</div>
                    <div className='text-[9px] opacity-80'>Door_Sensor</div>
                  </div>

                  <span className={`h-0.5 w-8 ${q00_conveyor ? 'bg-emerald-400' : 'bg-slate-700'}`} />

                  {/* Output Coil Q0.0 */}
                  <div className={`px-3 py-1.5 rounded-full border text-center font-bold ${q00_conveyor ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300 shadow-[0_0_10px_#10b981]' : 'border-slate-700 text-slate-500'}`}>
                    ( ) Q0.0 (Băng Tải)
                  </div>

                  {/* Right Power Rail */}
                  <div className='w-1.5 h-12 bg-slate-700 rounded ms-auto' />
                </div>
              </div>

              {/* Ladder Network 2: Red Tower Alarm Indicator */}
              <div className='space-y-2 pt-2'>
                <span className='text-xs font-mono font-bold text-destructive block'>
                  Network 2: Cảnh Báo Đèn Tháp Đỏ (Red Tower Light Alarm)
                </span>

                <div className='relative p-4 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs overflow-x-auto flex items-center gap-3'>
                  {/* Left Power Rail */}
                  <div className='w-1.5 h-12 bg-emerald-500 rounded' />

                  {/* Fault Condition Contact */}
                  <div className={`px-2 py-1.5 rounded border text-center ${q02_redTower ? 'border-destructive bg-destructive/20 text-destructive font-bold' : 'border-slate-700 text-slate-500'}`}>
                    <div>[ / ] Fault</div>
                    <div className='text-[9px] opacity-80'>E_Stop / Door_Open</div>
                  </div>

                  <span className={`h-0.5 w-12 ${q02_redTower ? 'bg-destructive' : 'bg-slate-700'}`} />

                  {/* Output Coil Q0.2 Red Light */}
                  <div className={`px-3 py-1.5 rounded-full border text-center font-bold ${q02_redTower ? 'border-destructive bg-destructive/40 text-destructive shadow-[0_0_12px_#ef4444] animate-pulse' : 'border-slate-700 text-slate-500'}`}>
                    ( ) Q0.2 (Đèn Đỏ Alarm)
                  </div>

                  {/* Right Power Rail */}
                  <div className='w-1.5 h-12 bg-slate-700 rounded ms-auto' />
                </div>
              </div>
            </div>

            {/* Current Real-time Output Summary */}
            <div className='grid grid-cols-2 gap-3 text-xs'>
              <div className={`p-3 rounded-lg border flex items-center justify-between ${
                q00_conveyor ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-muted/30 border-border/40 text-muted-foreground'
              }`}>
                <span>Output Q0.0 — Động Cơ Băng Tải:</span>
                <strong className='font-mono'>{q00_conveyor ? 'POWER ON (24V)' : 'STOPPED'}</strong>
              </div>

              <div className={`p-3 rounded-lg border flex items-center justify-between ${
                q02_redTower ? 'bg-destructive/15 border-destructive/40 text-destructive' : 'bg-muted/30 border-border/40 text-muted-foreground'
              }`}>
                <span>Output Q0.2 — Cảnh Báo Tháp Đỏ:</span>
                <strong className='font-mono'>{q02_redTower ? 'ALARM ACTIVE' : 'NORMAL'}</strong>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
