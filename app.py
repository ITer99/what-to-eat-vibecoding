"""本机菜单随机选择，使用本地 JSON 文件保留菜单。"""
import argparse
import html
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import random
import threading
import tempfile
import sys
import webbrowser

DEFAULT_MENUS = ["牛肉面", "饺子", "炒饭", "鸡肉饭", "麻辣烫"]
MENUS = []
MENUS_LOCK = threading.Lock()
BASE_DIR = Path(__file__).resolve().parent
PAGE = BASE_DIR / "index.html"
DATA_FILE = BASE_DIR / "data" / "menus.json"

class MenuDataError(Exception):
    """菜单文件无法安全读取或初始化。"""


def save_menus(menus, path):
    """先写完同目录临时文件，再替换正式文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n",
            dir=path.parent, prefix=".menus-", suffix=".tmp", delete=False,
        ) as file:
            temporary = Path(file.name)
            json.dump(menus, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        # Windows 下先关闭临时文件，再替换目标；不直接改写原文件。
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def load_menus(path):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        menus = DEFAULT_MENUS.copy()
        try:
            save_menus(menus, path)
        except OSError as error:
            raise MenuDataError(f"无法创建菜单文件：{path}\n原因：{error}") from error
        return menus
    except (OSError, UnicodeError) as error:
        raise MenuDataError(f"无法读取菜单文件：{path}\n原文件未修改。原因：{error}") from error
    try:
        menus = json.loads(text)
    except ValueError as error:
        raise MenuDataError(f"菜单文件损坏：{path}\n原文件已保留，未恢复默认菜单。原因：{error}") from error
    if (
        not isinstance(menus, list)
        or any(not isinstance(menu, str) or not menu.strip() or menu != menu.strip() for menu in menus)
        or len(set(menus)) != len(menus)
    ):
        raise MenuDataError(
            f"菜单文件格式错误：{path}\n"
            "需要菜名列表（允许为空），名称不能空白、重复或含首尾空格。原文件已保留，未恢复默认菜单。"
        )
    return menus

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            with MENUS_LOCK:
                menus = MENUS.copy()
            items = "".join(
                f'<li><span>{html.escape(menu)}</span> '
                f'<button type="button" data-menu="{html.escape(menu, quote=True)}" '
                f'aria-label="删除{html.escape(menu, quote=True)}">删除</button></li>'
                for menu in menus
            )
            body = (
                PAGE.read_text(encoding="utf-8")
                .replace("{{count}}", str(len(menus)))
                .replace("{{choose_disabled}}", "disabled" if not menus else "")
                .replace("{{initial_result}}", "先添加一道菜" if not menus else "点击按钮，开始选餐。")
                .replace("{{empty_hidden}}", "" if not menus else "hidden")
                .replace("{{menus}}", items)
            )
            self.respond(body.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path in ("/wheel.js", "/sound.js", "/sound-data.js"):
            self.respond((BASE_DIR / self.path[1:]).read_bytes(), "text/javascript; charset=utf-8")
        elif self.path == "/api/choose":
            with MENUS_LOCK:
                menus = MENUS.copy()
                index = random.randrange(len(menus)) if menus else None
            if index is None:
                self.respond_json({"error": "先添加一道菜", "menus": []}, 409)
                return
            self.respond_json({"menus": menus, "index": index, "menu": menus[index]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path not in ("/api/menus", "/api/menus/delete"):
            self.send_error(404)
            return
        if self.headers.get_content_type() != "application/json":
            self.respond_json({"error": "请使用 JSON 提交菜单。"}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                self.respond_json({"error": "提交内容为空或过长。"}, 400)
                return
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.respond_json({"error": "无法读取提交的菜单。"}, 400)
            return
        if not isinstance(data, dict) or not isinstance(data.get("menu"), str):
            self.respond_json({"error": "请输入菜名。"}, 400)
            return
        menu = data["menu"].strip()
        if not menu:
            self.respond_json({"error": "菜名不能为空，请输入菜名。"}, 400)
            return
        if self.path == "/api/menus/delete":
            self.delete_menu(menu)
            return
        try:
            with MENUS_LOCK:
                duplicate = menu in MENUS
                if not duplicate:
                    menus = MENUS + [menu]
                    save_menus(menus, DATA_FILE)
                    # 保存成功后才让新菜单进入内存和随机候选集合。
                    MENUS[:] = menus
        except OSError as error:
            print(f"菜单保存失败：{DATA_FILE}\n原因：{error}", file=sys.stderr, flush=True)
            self.respond_json({"error": "保存失败，菜单未添加。请检查数据文件夹是否可写、磁盘空间是否充足，再重试。"}, 500)
            return
        if duplicate:
            self.respond_json({"error": f"“{menu}”已经在菜单里了，请勿重复添加。"}, 409)
            return
        self.respond_json({"menu": menu, "menus": menus}, 201)

    def delete_menu(self, menu):
        try:
            with MENUS_LOCK:
                exists = menu in MENUS
                if exists:
                    menus = [item for item in MENUS if item != menu]
                    save_menus(menus, DATA_FILE)
                    MENUS[:] = menus
        except OSError as error:
            print(f"菜单删除保存失败：{DATA_FILE}\n原因：{error}", file=sys.stderr, flush=True)
            self.respond_json({"error": "删除未成功：保存失败。原菜单未改变，请检查数据文件夹权限或磁盘空间后重试。"}, 500)
            return
        if not exists:
            self.respond_json({"error": "该菜名已不在候选菜单中，请刷新后重试。"}, 404)
            return
        self.respond_json({"menu": menu, "menus": menus})

    def respond_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.respond(body, "application/json; charset=utf-8", status)

    def respond(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

def main():
    parser = argparse.ArgumentParser(description="今天吃什么")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        MENUS[:] = load_menus(DATA_FILE)
    except MenuDataError as error:
        print(f"启动失败：{error}", file=sys.stderr, flush=True)
        return 1
    # 由系统分配空闲端口，只允许本机访问，不暴露项目目录。
    # 分别处理连接，避免浏览器的空闲预连接阻塞页面和接口请求。
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"URL: {url}", flush=True)
        print("今天吃什么已启动。保持此窗口打开；关闭窗口或按 Ctrl+C 可退出。", flush=True)
        if not args.no_browser:
            timer = threading.Timer(0.2, webbrowser.open, args=(url,))
            timer.daemon = True
            timer.start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("程序已退出。", flush=True)

if __name__ == "__main__":
    sys.exit(main())
