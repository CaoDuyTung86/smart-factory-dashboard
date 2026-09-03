import { AlertOctagon, AlertTriangle, Check, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatClock } from '../lib/format'
import { type AlarmEvent } from '../types'

interface AlarmTableProps {
  alarms: AlarmEvent[]
  onAcknowledge: (alarmId: string) => void
  onRepair: (machineId: string) => void
}

export function AlarmTable({
  alarms,
  onAcknowledge,
  onRepair,
}: AlarmTableProps) {
  const unackCount = alarms.filter((a) => !a.acknowledged).length

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='flex flex-row items-center justify-between pb-3'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            <AlertOctagon className='h-5 w-5 text-destructive' />
            Nhật Ký Cảnh Báo Sự Cố Real-time
          </CardTitle>
          <CardDescription>
            Cảnh báo tự động từ cảm biến IoT khi phát hiện vượt ngưỡng an toàn
          </CardDescription>
        </div>
        {unackCount > 0 && (
          <Badge variant='destructive' className='px-3 py-1 text-xs'>
            {unackCount} Cảnh báo cần xử lý
          </Badge>
        )}
      </CardHeader>

      <CardContent>
        {alarms.length === 0 ? (
          <div className='rounded-lg border border-dashed bg-muted/20 py-8 text-center text-sm text-muted-foreground'>
            🟢 Chưa phát hiện sự cố nào. Hệ thống đang hoạt động an toàn.
          </div>
        ) : (
          <div className='overflow-x-auto rounded-lg border border-border/40'>
            <Table>
              <TableHeader className='bg-muted/40'>
                <TableRow>
                  <TableHead className='w-[100px]'>Thời gian</TableHead>
                  <TableHead className='w-[140px]'>Thiết bị</TableHead>
                  <TableHead>Nội dung cảnh báo</TableHead>
                  <TableHead className='w-[110px]'>Mức độ</TableHead>
                  <TableHead className='w-[180px] text-right'>
                    Thao tác
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alarms.map((alarm) => (
                  <TableRow
                    key={alarm.id}
                    className={
                      !alarm.acknowledged
                        ? 'bg-destructive/10 hover:bg-destructive/15'
                        : 'opacity-70'
                    }
                  >
                    <TableCell className='font-mono text-xs text-muted-foreground'>
                      {formatClock(alarm.timestamp)}
                    </TableCell>
                    <TableCell className='text-xs font-medium'>
                      {alarm.machineName}
                    </TableCell>
                    <TableCell className='text-xs font-semibold'>
                      {alarm.message}
                    </TableCell>
                    <TableCell>
                      {alarm.severity === 'critical' ? (
                        <Badge
                          variant='destructive'
                          className='gap-1 px-2 py-0.5 text-[10px]'
                        >
                          <AlertTriangle className='h-3 w-3' /> Critical
                        </Badge>
                      ) : (
                        <Badge className='bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-500 hover:bg-amber-500/30'>
                          Warning
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='space-x-1.5 text-right'>
                      {!alarm.acknowledged && (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 gap-1 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500'
                          onClick={() => onRepair(alarm.machineId)}
                        >
                          <Wrench className='h-3 w-3' /> Sửa Máy
                        </Button>
                      )}

                      {alarm.acknowledged ? (
                        <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                          <Check className='h-3.5 w-3.5 text-emerald-500' /> Đã
                          xử lý
                        </span>
                      ) : (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 bg-background text-xs hover:bg-muted'
                          onClick={() => onAcknowledge(alarm.id)}
                        >
                          Xác nhận
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
