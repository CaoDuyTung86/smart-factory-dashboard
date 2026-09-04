import { memo, useState } from 'react'
import { Cpu, Radio, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useFactoryStore } from '../hooks/use-factory-store'
import { usePlcLink } from '../hooks/use-plc-link'
import {
  INITIAL_LADDER_INPUTS,
  safetyFaultOf,
  solveLadder,
  type LadderInputs,
} from '../lib/ladder'
import { plcGateway } from '../services/plcGateway'

/**
 * Field signals as the CPU sees them at the input terminals — the rungs
 * themselves live in `../lib/ladder`, which mirrors `infra/plc/conveyor.st`.
 * This screen only wires the buttons to that solver, so the simulated mode and
 * the live PLC cannot disagree about what the ladder means.
 */
type PlcInputs = LadderInputs

const INITIAL_INPUTS = INITIAL_LADDER_INPUTS

/** Siemens analog modules map 0–10 V onto 0…27648 counts (nominal range). */
const SIEMENS_FULL_SCALE = 27648
const TEMP_SENSOR_SPAN_C = 100

const AnalogInputs = memo(function AnalogInputs() {
  const machines = useFactoryStore((s) => s.machines)
  const smt = machines.find((m) => m.id === 'SMT-LINE-01')
  const tempC = smt?.temperature ?? 0
  const rawCounts = Math.round(
    (tempC / TEMP_SENSOR_SPAN_C) * SIEMENS_FULL_SCALE
  )

  return (
    <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
      <span className='block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
        📈 Analog Input AI 4x13BIT — Kênh AI0 (PT100 SMT-LINE-01)
      </span>

      <div className='grid grid-cols-3 gap-2 pt-1 text-center font-mono'>
        <div className='rounded border border-border/40 bg-background/60 p-1.5'>
          <div className='text-[10px] text-muted-foreground'>Giá trị thô</div>
          <div className='font-bold text-primary'>{rawCounts}</div>
        </div>
        <div className='rounded border border-border/40 bg-background/60 p-1.5'>
          <div className='text-[10px] text-muted-foreground'>Điện áp</div>
          <div className='font-bold text-blue-400'>
            {((rawCounts / SIEMENS_FULL_SCALE) * 10).toFixed(2)} V
          </div>
        </div>
        <div className='rounded border border-border/40 bg-background/60 p-1.5'>
          <div className='text-[10px] text-muted-foreground'>Quy đổi</div>
          <div className='font-bold text-amber-400'>{tempC.toFixed(1)} °C</div>
        </div>
      </div>

      <div className='font-mono text-[10px] text-muted-foreground'>
        NORM_X / SCALE_X: °C = raw ÷ {SIEMENS_FULL_SCALE} × {TEMP_SENSOR_SPAN_C}
      </div>
    </div>
  )
})

export function PlcDiagnostics() {
  // Khi edge gateway (infra/) đang chạy, màn hình này là HMI thật: mọi giá trị
  // đọc từ OpenPLC qua Modbus TCP và mọi nút bấm ghi ngược xuống PLC. Khi
  // không có gateway, nó chạy đúng logic đó nhưng mô phỏng ngay trong trình duyệt.
  const link = usePlcLink()
  const live = link.enabled && link.status === 'online' && link.plcConnected

  const [localInputs, setLocalInputs] = useState<PlcInputs>(INITIAL_INPUTS)
  /** Q0.0 has memory (seal-in branch), so it is state, not a derived value. */
  const [localConveyor, setLocalConveyor] = useState(false)

  // Tín hiệu vào của PLC thật: nút Stop/E-Stop đấu NC nên bit lệnh "đang bấm"
  // được đảo lại thành "tín hiệu khoẻ".
  const inputs: PlcInputs = live
    ? {
        i00_startPb: link.commands.start,
        i01_stopPb: !link.commands.stop,
        i02_eStop: !link.commands.estop,
        i03_doorClosed: !link.commands.door_open,
      }
    : localInputs

  const q00_conveyor = live ? link.outputs.conveyor : localConveyor

  // One scan cycle: read inputs -> solve the rungs -> write outputs.
  const scan = (next: PlcInputs) => {
    setLocalInputs(next)
    setLocalConveyor((prev) => solveLadder(next, prev).q00_conveyor)
  }

  const setInput = <K extends keyof PlcInputs>(key: K, value: boolean) => {
    if (!live) {
      scan({ ...localInputs, [key]: value })
      return
    }

    // Chế độ live: không tự tính logic nữa, chỉ ghi lệnh xuống PLC rồi chờ
    // vòng quét của nó trả kết quả về. Nút nhấn nhả do gateway tự tạo xung,
    // nên chỉ cần gửi lúc bấm xuống.
    switch (key) {
      case 'i00_startPb':
        if (value) plcGateway.sendCommand('start')
        break
      case 'i01_stopPb':
        if (!value) plcGateway.sendCommand('stop')
        break
      case 'i02_eStop':
        plcGateway.sendCommand('estop', !value)
        break
      case 'i03_doorClosed':
        plcGateway.sendCommand('door_open', !value)
        break
    }
  }

  // In live mode the PLC is the authority for the coils. In simulated mode the
  // towers are derived from the coil the last scan actually latched, not from a
  // fresh solve, so what the lamps show is what Q0.0 really is.
  const safetyFault = safetyFaultOf(inputs)
  const q02_redTower = live ? link.outputs.red_tower : safetyFault
  const q03_greenTower = live
    ? link.outputs.green_tower
    : q00_conveyor && !safetyFault
  const sealedIn = q00_conveyor && !inputs.i00_startPb

  return (
    <Card className='border-primary/30 bg-card/60'>
      <CardHeader className='flex flex-row items-center justify-between pb-3'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            <Cpu className='h-5 w-5 text-blue-400' />
            Mô Phỏng PLC Siemens SIMATIC S7-1200 & Logic Sơ Đồ Thang (TIA Portal
            V16)
          </CardTitle>
          <CardDescription>
            Trực quan hóa cấu trúc phần cứng I/O Rack CPU 1212C, bảng đèn LED
            tín hiệu và chương trình Ladder Diagram có mạch tự giữ
          </CardDescription>
        </div>

        {live ? (
          <Badge
            variant='outline'
            className='gap-1.5 border-emerald-500/40 bg-emerald-500/10 py-1 font-mono text-xs text-emerald-400'
          >
            <Radio className='h-3 w-3 animate-pulse' /> LIVE — OpenPLC qua
            Modbus TCP ({link.scanMs.toFixed(1)}ms)
          </Badge>
        ) : (
          <Badge
            variant='outline'
            className='gap-1.5 border-blue-500/30 bg-blue-500/10 py-1 font-mono text-xs text-blue-400'
          >
            <Radio className='h-3 w-3' />
            {link.enabled
              ? 'Đang tìm gateway… (mô phỏng cục bộ)'
              : 'Mô phỏng cục bộ — chưa nối PLC'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
          {/* Siemens S7-1200 PLC Hardware Rack Graphic */}
          <div className='space-y-4'>
            <div className='space-y-4 rounded-xl border-2 border-slate-700 bg-slate-900 p-4 shadow-xl'>
              <div className='flex items-center justify-between border-b border-slate-800 pb-2'>
                <span className='font-mono text-xs font-black tracking-widest text-slate-300 uppercase'>
                  SIEMENS
                </span>
                <span className='font-mono text-[10px] text-slate-400'>
                  SIMATIC S7-1200 CPU 1212C
                </span>
              </div>

              <div className='grid grid-cols-4 gap-2 text-center font-mono text-[10px]'>
                <div className='col-span-2 space-y-2 rounded border border-slate-700 bg-slate-800 p-2.5'>
                  <div className='text-xs font-bold text-slate-200'>
                    CPU 1212C
                  </div>
                  <div className='text-[9px] font-semibold text-emerald-400'>
                    RUN / STOP: RUN
                  </div>
                  <div className='flex justify-center gap-1.5 pt-1'>
                    <span className='h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]' />
                    <span
                      className={
                        'h-2 w-2 rounded-full ' +
                        (safetyFault
                          ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                          : 'bg-slate-700')
                      }
                    />
                    <span className='h-2 w-2 rounded-full bg-slate-700' />
                  </div>
                </div>

                <div className='space-y-1 rounded border border-slate-700 bg-slate-800 p-2'>
                  <div className='font-bold text-slate-300'>DI 8x24V</div>
                  <div className='text-[8px] text-slate-400'>Inputs</div>
                  <div className='grid grid-cols-2 gap-1 pt-1'>
                    {[
                      inputs.i00_startPb,
                      inputs.i01_stopPb,
                      inputs.i02_eStop,
                      inputs.i03_doorClosed,
                    ].map((on, i) => (
                      <div
                        key={i}
                        className={
                          'h-2 rounded-full ' +
                          (on
                            ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                            : 'bg-slate-700')
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className='space-y-1 rounded border border-slate-700 bg-slate-800 p-2'>
                  <div className='font-bold text-slate-300'>AI 4x13BIT</div>
                  <div className='text-[8px] text-slate-400'>Analog</div>
                  <div className='pt-2 text-[9px] font-bold text-amber-400'>
                    0-10V
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Inputs Toggle Panel */}
            <div className='space-y-2.5 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <span className='block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                🎛️ Bảng Thao Tác Tín Hiệu Đầu Vào (Digital Inputs)
              </span>

              {/* Momentary push buttons: press and release, exactly like the real
                  panel — the motor keeps running through the seal-in branch. */}
              <div className='flex items-center justify-between'>
                <span>I0.0 — Nút Start (nhấn nhả, NO):</span>
                <Button
                  size='sm'
                  variant={inputs.i00_startPb ? 'default' : 'outline'}
                  className='h-6 px-2 text-[10px]'
                  onPointerDown={() => setInput('i00_startPb', true)}
                  onPointerUp={() => setInput('i00_startPb', false)}
                  onPointerLeave={() =>
                    inputs.i00_startPb && setInput('i00_startPb', false)
                  }
                >
                  {inputs.i00_startPb ? 'Đang nhấn (24V)' : 'Nhấn giữ để Start'}
                </Button>
              </div>

              <div className='flex items-center justify-between'>
                <span>I0.1 — Nút Stop (nhấn nhả, NC):</span>
                <Button
                  size='sm'
                  variant={inputs.i01_stopPb ? 'outline' : 'destructive'}
                  className='h-6 px-2 text-[10px]'
                  onPointerDown={() => setInput('i01_stopPb', false)}
                  onPointerUp={() => setInput('i01_stopPb', true)}
                  onPointerLeave={() =>
                    !inputs.i01_stopPb && setInput('i01_stopPb', true)
                  }
                >
                  {inputs.i01_stopPb ? 'Nhấn giữ để Stop' : 'Đang nhấn (0V)'}
                </Button>
              </div>

              <div className='flex items-center justify-between'>
                <span>I0.2 — Chuỗi E-Stop (NC, chốt cơ khí):</span>
                <Button
                  size='sm'
                  variant={inputs.i02_eStop ? 'default' : 'destructive'}
                  className='h-6 px-2 text-[10px]'
                  onClick={() => setInput('i02_eStop', !inputs.i02_eStop)}
                >
                  {inputs.i02_eStop ? 'Bình thường (24V)' : 'Đã bấm (0V)'}
                </Button>
              </div>

              <div className='flex items-center justify-between'>
                <span>I0.3 — Cảm biến cửa an toàn:</span>
                <Button
                  size='sm'
                  variant={inputs.i03_doorClosed ? 'default' : 'destructive'}
                  className='h-6 px-2 text-[10px]'
                  onClick={() =>
                    setInput('i03_doorClosed', !inputs.i03_doorClosed)
                  }
                >
                  {inputs.i03_doorClosed
                    ? 'Đã đóng (Safe)'
                    : 'Đang mở (Unsafe)'}
                </Button>
              </div>

              <p className='border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground'>
                Nút Start/Stop là loại nhấn nhả: buông tay ra băng tải vẫn chạy
                nhờ tiếp điểm tự giữ Q0.0 ở nhánh song song (seal-in) — đúng như
                mạch thật, khác hẳn công tắc gạt.
              </p>
            </div>

            <AnalogInputs />
          </div>

          {/* Right Workspace: Live Ladder Logic Viewer */}
          <div className='space-y-4 lg:col-span-2'>
            <div className='space-y-4 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-xl'>
              <div className='flex items-center justify-between border-b border-slate-800 pb-2 font-mono text-xs text-slate-400'>
                <span>PROGRAM BLOCKS ➔ Main [OB1] (Ladder Diagram)</span>
                <span>Language: LAD</span>
              </div>

              {/* Network 1: motor with seal-in branch */}
              <div className='space-y-2'>
                <span className='block font-mono text-xs font-bold text-amber-400'>
                  Network 1: Điều khiển Động Cơ Băng Tải (Start/Stop có tự giữ)
                </span>

                <div className='relative overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs'>
                  <div className='flex min-w-max items-stretch gap-3'>
                    <div className='w-1.5 rounded bg-emerald-500' />

                    {/* Start contact in parallel with the Q0.0 seal-in contact */}
                    <div className='flex flex-col justify-center gap-1.5'>
                      <Contact
                        active={inputs.i00_startPb}
                        label='[ ] I0.0'
                        sub='Start_PB (NO)'
                      />
                      <div className='flex items-center gap-1'>
                        <span className='h-0.5 w-2 bg-slate-700' />
                        <Contact
                          active={q00_conveyor}
                          label='[ ] Q0.0'
                          sub='Seal-in (tự giữ)'
                        />
                      </div>
                    </div>

                    <Wire on={inputs.i00_startPb || q00_conveyor} />
                    <Contact
                      active={inputs.i01_stopPb}
                      label='[ ] I0.1'
                      sub='Stop_PB (NC wired)'
                    />
                    <Wire
                      on={
                        (inputs.i00_startPb || q00_conveyor) &&
                        inputs.i01_stopPb
                      }
                    />
                    <Contact
                      active={inputs.i02_eStop}
                      label='[ ] I0.2'
                      sub='E_Stop_OK (NC wired)'
                    />
                    <Wire
                      on={
                        (inputs.i00_startPb || q00_conveyor) &&
                        inputs.i01_stopPb &&
                        inputs.i02_eStop
                      }
                    />
                    <Contact
                      active={inputs.i03_doorClosed}
                      label='[ ] I0.3'
                      sub='Door_Closed'
                    />
                    <Wire on={q00_conveyor} />

                    <Coil active={q00_conveyor} label='( ) Q0.0 (Băng Tải)' />
                    <div className='ms-auto w-1.5 rounded bg-slate-700' />
                  </div>

                  {sealedIn && (
                    <div className='mt-3 border-t border-slate-800 pt-2 text-[10px] text-emerald-400'>
                      ▸ Đã buông nút Start — dòng điện đang đi qua nhánh tự giữ
                      Q0.0.
                    </div>
                  )}
                </div>
              </div>

              {/* Network 2: Red tower light */}
              <div className='space-y-2 pt-2'>
                <span className='block font-mono text-xs font-bold text-destructive'>
                  Network 2: Cảnh Báo Đèn Tháp Đỏ (Red Tower Light Alarm)
                </span>

                <div className='overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs'>
                  <div className='flex min-w-max items-stretch gap-3'>
                    <div className='w-1.5 rounded bg-emerald-500' />
                    <div className='flex flex-col justify-center gap-1.5'>
                      <Contact
                        active={!inputs.i02_eStop}
                        label='[ / ] I0.2'
                        sub='E_Stop pressed'
                        danger
                      />
                      <div className='flex items-center gap-1'>
                        <span className='h-0.5 w-2 bg-slate-700' />
                        <Contact
                          active={!inputs.i03_doorClosed}
                          label='[ / ] I0.3'
                          sub='Door open'
                          danger
                        />
                      </div>
                    </div>
                    <Wire on={q02_redTower} danger />
                    <Coil
                      active={q02_redTower}
                      label='( ) Q0.2 (Đèn Đỏ)'
                      danger
                    />
                    <div className='ms-auto w-1.5 rounded bg-slate-700' />
                  </div>
                </div>
              </div>

              {/* Network 3: Green tower light */}
              <div className='space-y-2 pt-2'>
                <span className='block font-mono text-xs font-bold text-emerald-400'>
                  Network 3: Đèn Tháp Xanh Báo Chạy (Green Tower Light)
                </span>

                <div className='overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs'>
                  <div className='flex min-w-max items-stretch gap-3'>
                    <div className='w-1.5 rounded bg-emerald-500' />
                    <Contact
                      active={q00_conveyor}
                      label='[ ] Q0.0'
                      sub='Conveyor run'
                    />
                    <Wire on={q00_conveyor && !safetyFault} />
                    <Contact
                      active={!safetyFault}
                      label='[ / ] Fault'
                      sub='Không có lỗi an toàn'
                    />
                    <Wire on={q03_greenTower} />
                    <Coil active={q03_greenTower} label='( ) Q0.3 (Đèn Xanh)' />
                    <div className='ms-auto w-1.5 rounded bg-slate-700' />
                  </div>
                </div>
              </div>
            </div>

            {/* Output summary */}
            <div
              className={
                'grid grid-cols-1 gap-3 text-xs ' +
                (live ? 'sm:grid-cols-4' : 'sm:grid-cols-3')
              }
            >
              <OutputTile
                label='Q0.0 — Động Cơ Băng Tải'
                value={q00_conveyor ? 'POWER ON (24V)' : 'STOPPED'}
                on={q00_conveyor}
              />
              <OutputTile
                label='Q0.2 — Cảnh Báo Tháp Đỏ'
                value={q02_redTower ? 'ALARM ACTIVE' : 'NORMAL'}
                on={q02_redTower}
                danger
              />
              <OutputTile
                label='Q0.3 — Đèn Tháp Xanh'
                value={q03_greenTower ? 'RUNNING' : 'OFF'}
                on={q03_greenTower}
              />
              {live && (
                <OutputTile
                  label='QW0 — Bộ Đếm Sản Lượng'
                  value={link.partCount.toLocaleString() + ' pcs'}
                  on={q00_conveyor}
                />
              )}
            </div>

            {/* Safety note — the part a PLC program alone must never own */}
            <div className='flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs'>
              <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0 text-amber-500' />
              <p className='leading-relaxed text-muted-foreground'>
                <strong className='text-foreground'>
                  Lưu ý an toàn (ISO 13849-1 / IEC 62061):
                </strong>{' '}
                mạch E-Stop trong thực tế{' '}
                <strong className='text-foreground'>không được</strong> chỉ đi
                qua PLC tiêu chuẩn như mô phỏng ở đây. Nút dừng khẩn phải cắt
                nguồn động lực qua rơ-le an toàn cứng (safety relay) hoặc F-CPU,
                đạt tối thiểu Category 3 / PL d. Vòng logic trong OB1 chỉ dùng
                để báo trạng thái và khóa mềm.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Contact({
  active,
  label,
  sub,
  danger,
}: {
  active: boolean
  label: string
  sub: string
  danger?: boolean
}) {
  const onClasses = danger
    ? 'border-destructive bg-destructive/20 text-destructive font-bold'
    : 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold'

  return (
    <div
      className={
        'rounded border px-2 py-1.5 text-center ' +
        (active ? onClasses : 'border-slate-700 text-slate-500')
      }
    >
      <div>{label}</div>
      <div className='text-[9px] opacity-80'>{sub}</div>
    </div>
  )
}

function Wire({ on, danger }: { on: boolean; danger?: boolean }) {
  return (
    <span className='flex items-center'>
      <span
        className={
          'h-0.5 w-6 ' +
          (on ? (danger ? 'bg-destructive' : 'bg-emerald-400') : 'bg-slate-700')
        }
      />
    </span>
  )
}

function Coil({
  active,
  label,
  danger,
}: {
  active: boolean
  label: string
  danger?: boolean
}) {
  const onClasses = danger
    ? 'border-destructive bg-destructive/40 text-destructive shadow-[0_0_12px_#ef4444]'
    : 'border-emerald-400 bg-emerald-500/30 text-emerald-300 shadow-[0_0_10px_#10b981]'

  return (
    <div
      className={
        'flex items-center rounded-full border px-3 py-1.5 text-center font-bold ' +
        (active ? onClasses : 'border-slate-700 text-slate-500')
      }
    >
      {label}
    </div>
  )
}

function OutputTile({
  label,
  value,
  on,
  danger,
}: {
  label: string
  value: string
  on: boolean
  danger?: boolean
}) {
  const onClasses = danger
    ? 'bg-destructive/15 border-destructive/40 text-destructive'
    : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'

  return (
    <div
      className={
        'flex items-center justify-between rounded-lg border p-3 ' +
        (on ? onClasses : 'border-border/40 bg-muted/30 text-muted-foreground')
      }
    >
      <span>{label}:</span>
      <strong className='font-mono'>{value}</strong>
    </div>
  )
}
