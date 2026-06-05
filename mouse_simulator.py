"""
鼠标模拟器 —— 模拟人类鼠标操作的辅助工具

特点：
  - 贝塞尔曲线路径（鼠标不会走直线）
  - 变速运动（加速 -> 减速逼近目标）
  - 随机抖动和过冲（人类定位目标时会 overshoot）
  - 随机停顿（移动到目标后停顿一下再点击）
  - 支持屏幕-网页元素坐标映射

可作为独立脚本使用，也可集成到 Playwright/Selenium 项目中。
"""

import ctypes
import ctypes.wintypes  # 必须显式导入，否则会报 AttributeError
import math
import random
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

# ============================================================
# Windows API 封装
# ============================================================

class _SM(ctypes.Structure):
    """MOUSEINPUT 结构体"""
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]

class _IN(ctypes.Structure):
    """INPUT 结构体"""
    _fields_ = [
        ("type", ctypes.c_ulong),
        ("mi", _SM),
    ]

# Windows API 常量
INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800

# 获取屏幕尺寸（用于绝对坐标）
_user32 = ctypes.windll.user32
SCREEN_W = _user32.GetSystemMetrics(0)
SCREEN_H = _user32.GetSystemMetrics(1)


def _send_mouse(dx: int, dy: int, flags: int) -> None:
    """通过 Windows API 发送鼠标事件"""
    # 归一化坐标：0~65535（Windows 要求）
    abs_x = int(dx * 65535 // SCREEN_W)
    abs_y = int(dy * 65535 // SCREEN_H)
    inp = _IN(type=INPUT_MOUSE)
    inp.mi = _SM(abs_x, abs_y, 0, flags | MOUSEEVENTF_ABSOLUTE, 0, None)
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))


# ============================================================
# 路径生成 —— 贝塞尔曲线
# ============================================================

@dataclass
class Point:
    x: float
    y: float

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar: float) -> "Point":
        return Point(self.x * scalar, self.y * scalar)

    def __truediv__(self, scalar: float) -> "Point":
        return Point(self.x / scalar, self.y / scalar)

    def dist(self, other: "Point") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def tuple(self) -> tuple:
        return (int(self.x), int(self.y))


def _bezier_point(t: float, p0: Point, p1: Point, p2: Point, p3: Point) -> Point:
    """三次贝塞尔曲线上 t 时刻的点"""
    u = 1 - t
    return p0 * (u ** 3) + p1 * (3 * u ** 2 * t) + p2 * (3 * u * t ** 2) + p3 * (t ** 3)


def generate_bezier_path(
    start: Point,
    end: Point,
    num_points: int = 30,
    wobble: float = 0.2,
    overshoot: float = 0.0,
) -> list[Point]:
    """
    生成从 start 到 end 的贝塞尔曲线路径点。

    参数：
      num_points — 路径点数（越多越平滑）
      wobble    — 控制点偏移幅度（0=直线，越大越弯曲）
      overshoot — 过冲比例（0~0.15，模拟人类过头后回调）
    """
    dx = end.x - start.x
    dy = end.y - start.y
    dist = math.hypot(dx, dy)

    # 两个控制点：在垂直方向随机偏移，形成曲线
    mid1 = Point(
        start.x + dx * 0.25 + random.uniform(-1, 1) * dist * wobble,
        start.y + dy * 0.25 + random.uniform(-1, 1) * dist * wobble,
    )
    mid2 = Point(
        start.x + dx * 0.75 + random.uniform(-1, 1) * dist * wobble,
        start.y + dy * 0.75 + random.uniform(-1, 1) * dist * wobble,
    )

    # 过冲：终点再往前延伸一点，路径会过头再回来
    if overshoot > 0 and dist > 50:
        over_end = Point(
            end.x + dx * overshoot + random.uniform(-5, 5),
            end.y + dy * overshoot + random.uniform(-5, 5),
        )
    else:
        over_end = end

    # 生成路径点
    path = [_bezier_point(i / num_points, start, mid1, mid2, over_end)
            for i in range(num_points + 1)]

    # 如果用了过冲，把最后几个点修正到真正的终点
    if overshoot > 0 and dist > 50:
        # 最后 20% 的点重新映射到终点
        correction_start = int(num_points * 0.8)
        for i in range(correction_start, num_points + 1):
            t = (i - correction_start) / (num_points - correction_start)
            path[i] = Point(
                path[i].x * (1 - t) + end.x * t,
                path[i].y * (1 - t) + end.y * t,
            )

    return path


def _ease_out_back(t: float) -> float:
    """缓出 + 回弹效果 """
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def _noise_sample(base: float, noise: float) -> float:
    """给数值加上随机噪声"""
    return base + random.uniform(-noise, noise)


# ============================================================
# 鼠标模拟器核心类
# ============================================================

class MouseSimulator:
    """
    人类鼠标行为模拟器。

    用法：
        mouse = MouseSimulator()
        mouse.move_to(500, 300)      # 像人一样移动到 (500, 300)
        mouse.click()                # 左键点击
        mouse.click_right()          # 右键点击
        mouse.type_text("你好")       # 逐字模拟打字（含随机间隔）
    """

    def __init__(self, speed_factor: float = 1.0, verbose: bool = False):
        """
        参数：
          speed_factor — 速度倍数（1.0=正常，越大越快，0.5=慢速）
          verbose      — 是否输出详细日志
        """
        self.speed_factor = speed_factor
        self.verbose = verbose
        self._current_pos = self.get_position()
        self._rng = random.Random()

    # ---- 获取/设置位置 ----

    @staticmethod
    def get_position() -> Point:
        """获取当前鼠标坐标"""
        pt = ctypes.wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        return Point(pt.x, pt.y)

    @staticmethod
    def set_position(x: int, y: int) -> None:
        """瞬间移动（不模拟人类）"""
        _send_mouse(x, y, MOUSEEVENTF_MOVE)

    # ---- 人类化移动 ----

    def move_to(
        self,
        x: int,
        y: int,
        wobble: Optional[float] = None,
        overshoot: Optional[float] = None,
        duration: Optional[float] = None,
    ) -> None:
        """
        像人类一样移动到目标坐标。

        参数：
          wobble    — 弯曲程度（None=根据距离自动）
          overshoot — 过冲程度（None=根据距离自动）
          duration  — 持续时间秒（None=根据距离自动）
        """
        target = Point(x, y)
        start = self.get_position()
        dist = start.dist(target)

        if dist < 5:
            # 太近了，直接跳
            self.set_position(x, y)
            return

        # ---- 根据距离智能调节参数 ----
        if wobble is None:
            wobble = min(0.35, max(0.05, dist / 3000))

        if overshoot is None:
            overshoot = 0.03 if dist > 100 else 0.0

        if duration is None:
            # 人类移动时间 ≈ 距离的函数，加随机变化
            base_ms = 80 + dist * 0.4
            base_ms *= self.speed_factor
            duration = max(0.05, base_ms / 1000)
            # 加入 ±20% 随机
            duration *= random.uniform(0.8, 1.2)

        # ---- 生成路径 ----
        num_points = max(15, min(60, int(dist / 5)))
        path = generate_bezier_path(start, target, num_points, wobble, overshoot)

        # ---- 沿路径移动（变速） ----
        step_time = duration / len(path)

        for i, pt in enumerate(path):
            progress = i / len(path)

            # 变速：前 20% 加速，后 30% 减速
            if progress < 0.2:
                speed_mod = 0.5 + 0.5 * (progress / 0.2)  # 0.5 -> 1.0
            elif progress > 0.7:
                speed_mod = 1.0 - 0.6 * ((progress - 0.7) / 0.3)  # 1.0 -> 0.4
            else:
                speed_mod = 1.0

            actual_delay = step_time / speed_mod

            # 每步加入微小抖动（1~3 像素的随机偏移）
            jitter_x = int(random.uniform(-1.5, 1.5))
            jitter_y = int(random.uniform(-1.5, 1.5))

            _send_mouse(int(pt.x) + jitter_x, int(pt.y) + jitter_y, MOUSEEVENTF_MOVE)

            time.sleep(actual_delay)

        # ---- 最后精确锁定 ----
        # 小幅度微调（模拟人类最后几像素的精细定位）
        final_pos = self.get_position()
        if final_pos.dist(target) > 3:
            micro_steps = max(2, int(final_pos.dist(target) / 3))
            for _ in range(micro_steps):
                current = self.get_position()
                dx = (target.x - current.x) * random.uniform(0.4, 0.8)
                dy = (target.y - current.y) * random.uniform(0.4, 0.8)
                _send_mouse(
                    int(current.x + dx + random.uniform(-1, 1)),
                    int(current.y + dy + random.uniform(-1, 1)),
                    MOUSEEVENTF_MOVE,
                )
                time.sleep(random.uniform(0.008, 0.025))

        # 精确落点
        _send_mouse(x, y, MOUSEEVENTF_MOVE)
        self._current_pos = Point(x, y)

        if self.verbose:
            print(f"  鼠标移动到 ({x}, {y})，耗时 {duration:.2f}s")

    def move_to_element(
        self,
        element_selector: Callable,
        offset_x: int = 0,
        offset_y: int = 0,
        **kwargs,
    ) -> None:
        """
        获取页面上元素中心位置并移动鼠标过去（用于与 Playwright 结合）。

        参数：
          element_selector — 一个返回元素坐标 (x, y) 的回调函数
          offset_x/y      — 相对于元素中心的偏移
        """
        element_x, element_y = element_selector()
        self.move_to(element_x + offset_x, element_y + offset_y, **kwargs)

    # ---- 点击操作 ----

    def click(self, x: Optional[int] = None, y: Optional[int] = None) -> None:
        """
        鼠标左键点击。

        如果传入 x/y，先移动过去再点击。
        模拟真实点击：移动 -> 悬停停顿 -> 按下 -> 随机延迟 -> 释放
        """
        if x is not None and y is not None:
            self.move_to(x, y)

        # 点击前短暂停顿（人类点击前会有几十到几百毫秒的停留）
        time.sleep(random.uniform(0.04, 0.18))

        _send_mouse(0, 0, MOUSEEVENTF_LEFTDOWN)
        time.sleep(random.uniform(0.02, 0.08))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTUP)

        if self.verbose:
            print(f"  左键点击 ({x}, {y})")

    def click_right(self, x: Optional[int] = None, y: Optional[int] = None) -> None:
        """鼠标右键点击"""
        if x is not None and y is not None:
            self.move_to(x, y)

        time.sleep(random.uniform(0.04, 0.18))
        _send_mouse(0, 0, MOUSEEVENTF_RIGHTDOWN)
        time.sleep(random.uniform(0.02, 0.08))
        _send_mouse(0, 0, MOUSEEVENTF_RIGHTUP)

        if self.verbose:
            print(f"  右键点击 ({x}, {y})")

    def double_click(self, x: Optional[int] = None, y: Optional[int] = None) -> None:
        """双击"""
        if x is not None and y is not None:
            self.move_to(x, y)

        time.sleep(random.uniform(0.04, 0.15))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTDOWN)
        time.sleep(random.uniform(0.02, 0.05))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTUP)
        time.sleep(random.uniform(0.03, 0.08))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTDOWN)
        time.sleep(random.uniform(0.02, 0.05))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTUP)

        if self.verbose:
            print(f"  双击 ({x}, {y})")

    def drag(self, start_x: int, start_y: int, end_x: int, end_y: int) -> None:
        """拖拽：从起点按住拖到终点释放"""
        self.move_to(start_x, start_y)
        time.sleep(random.uniform(0.05, 0.15))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTDOWN)
        time.sleep(random.uniform(0.02, 0.05))

        # 拖拽路径（比普通移动更慢、更精确）
        self.move_to(
            end_x, end_y,
            wobble=0.05,     # 拖拽时弯曲较小
            overshoot=0.0,
            duration=random.uniform(0.2, 0.6),
        )
        time.sleep(random.uniform(0.02, 0.05))
        _send_mouse(0, 0, MOUSEEVENTF_LEFTUP)

        if self.verbose:
            print(f"  从 ({start_x}, {start_y}) 拖拽到 ({end_x}, {end_y})")

    def scroll(self, clicks: int = -3, x: Optional[int] = None, y: Optional[int] = None) -> None:
        """
        滚动滚轮。
        clicks: 正数=向上，负数=向下
        """
        if x is not None and y is not None:
            self.move_to(x, y)

        wheel_delta = 120 * clicks  # Windows 滚轮单位
        inp = _IN(type=INPUT_MOUSE)
        inp.mi = _SM(0, 0, ctypes.c_ulong(wheel_delta), MOUSEEVENTF_WHEEL, 0, None)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

        if self.verbose:
            print(f"  滚动 {'上' if clicks > 0 else '下'} {abs(clicks)} 格")

    # ---- 通用操作序列 ----

    def human_pause(self, min_ms: int = 300, max_ms: int = 1200) -> None:
        """随机停顿（模拟人类思考/阅读）"""
        time.sleep(random.randint(min_ms, max_ms) / 1000)

    def random_micro_movement(self, radius: int = 3) -> None:
        """
        微小鼠标移动（模拟真人手部微小颤动）。
        通常每 3~8 秒会出现一次。
        """
        pos = self.get_position()
        dx = random.randint(-radius, radius)
        dy = random.randint(-radius, radius)
        if dx != 0 or dy != 0:
            _send_mouse(
                int(pos.x + dx),
                int(pos.y + dy),
                MOUSEEVENTF_MOVE,
            )
            time.sleep(random.uniform(0.005, 0.015))
            _send_mouse(int(pos.x), int(pos.y), MOUSEEVENTF_MOVE)


# ============================================================
# 与 Playwright 集成的辅助函数
# ============================================================

async def playwright_human_click(page, selector: str, **kwargs):
    """
    在 Playwright 中模拟人类点击某个元素。

    用法：
        await playwright_human_click(page, 'button:has-text("沟通")')
        await playwright_human_click(page, '#submit-btn')
    """
    from playwright.async_api import Page

    # 获取元素位置
    el = await page.query_selector(selector)
    if not el:
        raise ValueError(f"未找到元素: {selector}")

    box = await el.bounding_box()
    if not box:
        raise ValueError(f"元素不可见: {selector}")

    # 元素内部随机偏移（避免每次点同一个像素）
    cx = box["x"] + box["width"] * random.uniform(0.2, 0.8)
    cy = box["y"] + box["height"] * random.uniform(0.2, 0.8)

    mouse = MouseSimulator(verbose=kwargs.get("verbose", False))
    mouse.move_to(int(cx), int(cy))
    mouse.click()

    # Playwright 的状态同步
    await page.wait_for_timeout(100)


async def playwright_human_type(page, selector: str, text: str, **kwargs):
    """
    模拟人类逐字输入（含随机间隔和偶尔的"打字错误"）。

    用法：
        await playwright_human_type(page, '#input-box', '你好世界')
    """
    await page.click(selector)
    await page.wait_for_timeout(random.randint(200, 500))

    for char in text:
        delay = random.randint(kwargs.get("min_ms", 40), kwargs.get("max_ms", 180))
        await page.wait_for_timeout(delay)

        # 5% 概率"打错"并修正（模拟真实人工）
        if random.random() < 0.05:
            wrong_char = random.choice("abcdefghijklmnopqrstuvwxyz")
            await page.keyboard.press(wrong_char)
            await page.wait_for_timeout(random.randint(150, 400))
            await page.keyboard.press("Backspace")
            await page.wait_for_timeout(random.randint(100, 300))

        await page.keyboard.press(char)


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    print("鼠标模拟器演示")
    print("-" * 40)
    print(f"屏幕分辨率: {SCREEN_W} x {SCREEN_H}")
    print("鼠标将在 3 秒后开始演示...")
    time.sleep(3)

    mouse = MouseSimulator(verbose=True)

    print("\n=== 演示：移动到屏幕四个角 ===")
    for x, y in [(100, 100), (500, 100), (500, 400), (100, 400)]:
        mouse.move_to(x, y, duration=0.6)
        mouse.human_pause(200, 500)

    print("\n=== 演示：画圆 ===")
    import math as _math
    cx, cy, r = 400, 300, 150
    for angle in range(0, 361, 10):
        rad = _math.radians(angle)
        x = int(cx + r * _math.cos(rad))
        y = int(cy + r * _math.sin(rad))
        mouse.move_to(x, y, duration=0.03)
    print("  圆形路径完成")

    print("\n=== 演示：点击 ===")
    mouse.click(300, 200)

    print("\n=== 演示：拖拽 ===")
    mouse.drag(200, 200, 400, 200)

    print("\n演示完成！")