# OpenPLC v3 — PLC mềm chạy chương trình IEC 61131-3 thật.
#
# Dự án OpenPLC không phát hành image dựng sẵn trên Docker Hub, nên phải build
# từ mã nguồn. File này lặp lại các bước trong Dockerfile chính thức của họ,
# chỉ khác là tự clone repo thay vì dùng git context của Compose — Docker
# Compose v5 (bake builder) không còn nhận URL git làm build context.
#
# Đổi OPENPLC_REF sang một commit SHA cụ thể nếu muốn build lặp lại được 100%.

FROM debian:trixie-20251020

ARG OPENPLC_REF=master

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${OPENPLC_REF}" \
    https://github.com/thiagoralves/OpenPLC_v3.git /workdir

WORKDIR /workdir

RUN mkdir /docker_persistent
VOLUME /docker_persistent

# Toàn bộ trạng thái (database, chương trình .st đã nạp, cấu hình Modbus) nằm
# trong /docker_persistent và được symlink ngược vào webserver, nên chương
# trình đã nạp vẫn còn sau khi container được tạo lại.
RUN ./install.sh docker \
    && touch /docker_persistent/mbconfig.cfg \
    && touch /docker_persistent/persistent.file \
    && mkdir -p /docker_persistent/st_files \
    && cp /workdir/webserver/openplc.db /docker_persistent/openplc.db \
    && mv /workdir/webserver/openplc.db /workdir/webserver/openplc_default.db \
    && cp /workdir/webserver/dnp3.cfg /docker_persistent/dnp3.cfg \
    && mv /workdir/webserver/dnp3.cfg /workdir/webserver/dnp3_default.cfg \
    && cp -r /workdir/webserver/st_files/. /docker_persistent/st_files/ \
    && mv /workdir/webserver/st_files /workdir/webserver/st_files_default \
    && cp /workdir/webserver/active_program /docker_persistent/active_program \
    && mv /workdir/webserver/active_program /workdir/webserver/active_program_default \
    && ln -s /docker_persistent/mbconfig.cfg /workdir/webserver/mbconfig.cfg \
    && ln -s /docker_persistent/persistent.file /workdir/webserver/persistent.file \
    && ln -s /docker_persistent/openplc.db /workdir/webserver/openplc.db \
    && ln -s /docker_persistent/dnp3.cfg /workdir/webserver/dnp3.cfg \
    && ln -s /docker_persistent/st_files /workdir/webserver/st_files \
    && ln -s /docker_persistent/active_program /workdir/webserver/active_program

# Bật "Start PLC in RUN mode": container khởi động lại là runtime tự chạy tiếp
# chương trình đã nạp, nên Modbus TCP :502 luôn sẵn sàng cho gateway. Ghi thẳng
# vào SQLite vì form Settings của OpenPLC không nhận POST từ script.
RUN python3 -c "import sqlite3; c = sqlite3.connect('/docker_persistent/openplc.db'); c.execute(\"UPDATE Settings SET Value='true' WHERE Key='Start_run_mode'\"); c.commit()"

EXPOSE 8080 502

ENTRYPOINT ["./start_openplc.sh"]
