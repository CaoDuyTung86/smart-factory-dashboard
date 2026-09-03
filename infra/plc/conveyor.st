(*
  conveyor.st — Chuong trinh PLC that (IEC 61131-3 Structured Text)
  Nap vao OpenPLC Runtime: Programs -> Upload Program -> chon file .st

  Day chinh la logic dang duoc ve o tab "PLC S7-1200 Rack & Ladder" tren web.
  Sau khi nap file nay, tab do khong con mo phong bang useState nua — no doc
  trang thai that tu runtime PLC qua Modbus TCP.

  --------------------------------------------------------------------------
  BAN DO DIA CHI MODBUS (OpenPLC v3)
  --------------------------------------------------------------------------
    %QX0.0 -> Coil 0    Conveyor      (dau ra dong co bang tai)
    %QX0.2 -> Coil 2    RedTower      (den thap do)
    %QX0.3 -> Coil 3    GreenTower    (den thap xanh)
    %QX1.0 -> Coil 8    CMD_Start     (lenh tu HMI)
    %QX1.1 -> Coil 9    CMD_Stop
    %QX1.2 -> Coil 10   CMD_EStop
    %QX1.3 -> Coil 11   CMD_DoorOpen
    %QW0   -> Holding Register 0      PartCount

  Vi sao lenh HMI nam o vung %QX chu khong phai %IX?
  Modbus master (gateway) chi duoc phep GHI vao coil (%QX) va holding register.
  Vung %IX la discrete input, chi do duoc — trong thuc te no do cong tac vat ly
  cap 24V. Khong co phan cung that nen HMI ghi vao %QX1.x, va chuong trinh chi
  DOC cac bit do, khong bao gio ghi de len chung.

  Khi noi PLC nay voi nut bam vat ly hoac voi Factory I/O, doi CMD_* sang
  %IX0.x tuong ung la xong — phan logic ben duoi giu nguyen.
*)

PROGRAM main
  VAR
    (* Lenh tu HMI / SCADA, ghi qua Modbus coil *)
    CMD_Start      AT %QX1.0 : BOOL;
    CMD_Stop       AT %QX1.1 : BOOL;
    CMD_EStop      AT %QX1.2 : BOOL;
    CMD_DoorOpen   AT %QX1.3 : BOOL;

    (* Dau ra vat ly *)
    Conveyor       AT %QX0.0 : BOOL;
    RedTower       AT %QX0.2 : BOOL;
    GreenTower     AT %QX0.3 : BOOL;

    (* Bo dem san luong, doc qua holding register 0 *)
    PartCount      AT %QW0   : INT;
  END_VAR

  (*
    MatIEC (trinh bien dich cua OpenPLC) khong cho tron bien co dia chi (AT %..)
    voi bien thuong trong cung mot khoi VAR — phai tach lam hai khoi.
  *)
  VAR
    Stop_OK        : BOOL;
    EStop_OK       : BOOL;
    Door_Closed    : BOOL;
    SafetyFault    : BOOL;
    Pulse1s        : TON;
  END_VAR

  (*
    Dau day kieu thuong dong (NC): nut Stop va E-Stop khi KHONG bi bam thi
    cap 24V vao dau vao, nen tin hieu doc ve la TRUE. Dut day -> mat 24V ->
    doc ve FALSE -> may dung. Do la nguyen tac fail-safe.
    Vi vay trong chuong trinh moi tiep diem deu la thuong mo [ ]: phan "thuong
    dong" nam o DAU DAY, khong nam trong code.
  *)
  Stop_OK     := NOT CMD_Stop;
  EStop_OK    := NOT CMD_EStop;
  Door_Closed := NOT CMD_DoorOpen;
  SafetyFault := (NOT EStop_OK) OR (NOT Door_Closed);

  (*
    Network 1 — Dieu khien dong co bang tai, co mach tu giu (seal-in).
    Nut Start la nut nhan nha: buong tay ra thi (CMD_Start = FALSE) nhung
    Conveyor van giu TRUE nho chinh no o ve phai cua phep OR.
    Khi bam E-Stop, Conveyor ve FALSE va KHONG tu chay lai luc nha E-Stop —
    phai bam Start lai (restart interlock, ISO 13849-1).
  *)
  Conveyor := (CMD_Start OR Conveyor) AND Stop_OK AND EStop_OK AND Door_Closed;

  (* Network 2 — Den thap do bao loi an toan *)
  RedTower := SafetyFault;

  (* Network 3 — Den thap xanh bao dang chay binh thuong *)
  GreenTower := Conveyor AND (NOT SafetyFault);

  (*
    Network 4 — Dem san luong: 1 pcs moi giay khi bang tai chay.
    Idiom TON tu reset: IN mat dien ngay khi Q len, tao xung tuan hoan.
  *)
  Pulse1s(IN := NOT Pulse1s.Q, PT := T#1s);
  IF Pulse1s.Q AND Conveyor THEN
    PartCount := PartCount + 1;
  END_IF;

END_PROGRAM


CONFIGURATION Config0

  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : main;
  END_RESOURCE

END_CONFIGURATION
