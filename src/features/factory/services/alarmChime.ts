/**
 * Còi cảnh báo của trạm vận hành.
 *
 * Tách khỏi `FactoryState` có chủ đích: còi bật hay tắt là thiết lập của *máy
 * đang ngồi*, không phải trạng thái của dây chuyền. Trên một SCADA thật, hai
 * trạm vận hành nhìn cùng một dây chuyền vẫn được phép đặt còi khác nhau — tắt
 * còi ở phòng họp không có nghĩa là tắt còi ngoài xưởng. Từ khi dữ liệu dây
 * chuyền do backend phát ra và mọi trình duyệt đều nhận cùng một gói tin, để
 * cờ này trong gói tin đó là sai hẳn về mặt mô hình.
 */

type Listener = () => void

const listeners = new Set<Listener>()
let enabled = false
let ctx: AudioContext | null = null

function notify() {
  listeners.forEach((l) => l())
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AudioCtxClass) return null
  ctx = new AudioCtxClass()
  return ctx
}

function chime(freq: number, duration: number) {
  const audio = ctx
  if (!audio || audio.state === 'closed') return
  try {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, audio.currentTime)
    gain.gain.setValueAtTime(0.1, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + duration)
    // Oscillator chỉ chạy được một lần: nhả graph ra ngay khi nó kết thúc,
    // nếu không mỗi tiếng bíp để lại một node treo.
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  } catch {
    // Chính sách autoplay chặn, hoặc context đã đóng — cảnh báo vẫn hiện trên
    // màn hình, chỉ là không có tiếng.
  }
}

export const alarmChime = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  isEnabled: () => enabled,

  setEnabled(next: boolean) {
    if (next === enabled) return
    enabled = next

    if (next) {
      const audio = ensureContext()
      if (audio?.state === 'suspended') void audio.resume()
      chime(660, 0.15)
    } else if (ctx) {
      // Suspend chứ không close: bật lại không phải dựng một context mới.
      void ctx.suspend().catch(() => undefined)
    }
    notify()
  },

  /** Bíp khi có cảnh báo mới. Tắt còi thì không làm gì cả. */
  beep() {
    if (!enabled) return
    chime(880, 0.3)
  },

  /** Gọi khi rời dashboard: trả lại tài nguyên audio của trình duyệt. */
  close() {
    if (!ctx) return
    void ctx.close().catch(() => undefined)
    ctx = null
  },
}
