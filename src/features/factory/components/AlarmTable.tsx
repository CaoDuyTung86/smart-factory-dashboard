import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlarmEvent } from '../types'
import { AlertOctagon, AlertTriangle, Check, Wrench } from 'lucide-react'

interface AlarmTableProps {
  alarms: AlarmEvent[]
  onAcknowledge: (alarmId: string) => void
  onRepair: (machineId: string) => void
}

export function AlarmTable({ alarms, onAcknowledge, onRepair }: AlarmTableProps) {
  const unackCount = alarms.filter((a) => !a.acknowledged).length

  return (
    <Card className='border-border/60 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='pb-3 flex flex-row items-center justify-between'>
        <div>
          <CardTitle className='text-lg font-bold flex items-center gap-2'>
            <AlertOctagon className='h-5 w-5 text-destructive' />
            Nhật Ký Cảnh Báo Sự Cố Real-time
          </CardTitle>
          <CardDescription>Cảnh báo tự động từ cảm biến IoT khi phát hiện vượt ngưỡng an toàn</CardDescription>
        </div>
        {unackCount > 0 && (
          <Badge variant='destructive' className='animate-pulse px-3 py-1 text-xs'>
            {unackCount} Cảnh báo cần xử lý
          </Badge>
        )}
      </CardHeader>

      <CardContent>
        {alarms.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground bg-muted/20 rounded-lg border border-dashed'>
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
                  <TableHead className='w-[180px] text-right'>Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alarms.map((alarm) => (
                  <TableRow 
                    key={alarm.id} 
                    className={!alarm.acknowledged ? 'bg-destructive/10 hover:bg-destructive/15' : 'opacity-70'}
                  >
                    <TableCell className='font-mono text-xs text-muted-foreground'>{alarm.timestamp}</TableCell>
                    <TableCell className='font-medium text-xs'>{alarm.machineName}</TableCell>
                    <TableCell className='text-xs font-semibold'>
                      {alarm.message}
                    </TableCell>
                    <TableCell>
                      {alarm.severity === 'critical' ? (
                        <Badge variant='destructive' className='text-[10px] px-2 py-0.5 gap-1'>
                          <AlertTriangle className='h-3 w-3' /> Critical
                        </Badge>
                      ) : (
                        <Badge className='bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 text-[10px] px-2 py-0.5'>
                          Warning
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right space-x-1.5'>
                      {!alarm.acknowledged && (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-1'
                          onClick={() => onRepair(alarm.machineId)}
                        >
                          <Wrench className='h-3 w-3' /> Sửa Máy
                        </Button>
                      )}

                      {alarm.acknowledged ? (
                        <span className='text-xs text-muted-foreground inline-flex items-center gap-1'>
                          <Check className='h-3.5 w-3.5 text-emerald-500' /> Đã xử lý
                        </span>
                      ) : (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 text-xs bg-background hover:bg-muted'
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
