---

选择题

1. 近日，空中客车公司表示，约6000架空客A320系列飞机需要紧急更换一种易受太阳辐射影响的飞行控制软件。空客表示，在对一起飞行事故进行分析后，结果表明强烈的太阳辐射可能会损坏飞行控制系统所需的关键数据，导致判断失误，进而可能引发飞行异常。在这里的飞行控制系统中，执行判断的部件最可能是下面的（   ）。 {{ select(1) }}

* 输出设备
* 内存单元
* 处理器
* 辐射传感器

2. 下面的 Python 代码在集成开发环境中运行时，提示有 “invalid character” 错误。可能的原因是（   ）：

    ```python
    a，b = 3，4
    print(a)
    print(b)
    ```

{{ select(2) }}

* L1 行应该分为两行，分别是 `a = 3` 和 `b = 4`。
* 代码运行前没有保存到文件。
* L2 和 L3 不能分为两行，应合并为一行。
* L1 行代码中的逗号很可能是中文逗号，应该改为英文逗号。

3. 下面有关 Python 变量的说法，正确的是（   ）。 {{ select(3) }}

* 不可以用 `for` 作为变量名，因为 `for` 是 Python 的关键字（保留字）。
* 可以用 `print` 作为变量名，因为 `print` 是关键字，但这不是好习惯，因为 `print` 有约定的功能与含义。
* `_tnt` 不可以是变量名，因为变量名的第一个字符必须是英文字母。
* `_tnt_` 不可以是变量名，因为最后一个字符容易与减号混淆。

4. Python 表达式 `2 + 3 * 4 ** 2` 的值为（   ）。 {{ select(4) }}

* 80
* 52
* 50
* 20

5. 下面的 Python 代码执行后，其输出是（   ）。

    ```python
    a, b = 3, 4
    print(a)
    print(b)
    ```

{{ select(5) }}

* 3 3
* 3 4
* 4 3
* 4 4

6. 下面的 Python 代码执行时如果先输入 10 回车后输入 20 并回车，其输出是（   ）。

    ```python
    N = input("第一个数:")
    M = input("第二个数:")
    print(f"int(N+M)={int(N+M)}")
    ```

{{ select(6) }}

* int(N+M)=1020
* 30=30
* 1020=1020
* 错误提示

7. 某个整数很长很长，形如：1232123212321……，其规律是从 1 开始逐一升高到 3，然后逐一降低到 1，然后又逐一升高到 3，一直到很长很长。假设从左到右第 1 位为 1。判断从左开始第 N 位数是几，在横线处应该填入的代码是（   ）。

    ```python
    N = int(input("请输入编号："))
    M = ________________
    
    if M != 0:
        print(M)
    else:
        print(2)
    ```

{{ select(7) }}

* N // 4
* N // 3
* N % 4
* N % 3

8. 下面 Python 代码执行后的输出是（   ）。

    ```python
    tnt = 0
    for i in range(100):
        tnt += 1
    print(tnt, i)
    ```

{{ select(8) }}

* 100 100
* 99 99
* 100 99
* 99 100

9. 有关下面 Python 代码的说法，错误的是（   ）。
    
    ```python
    tnt = 0
    for i in range(1, 10, 2):
        tnt += i
    print(tnt)
    ```

{{ select(9) }}

* `tnt += i` 与 `tnt = i + tnt` 效果相同。
* `range(1,10,2)` 改为 `range(1,11,2)` 结果相同。
* `tnt += i` 与 `tnt = tnt + i` 效果相同。
* `range(1,10,2)` 改为 `range(0,10,2)` 结果相同。

10. 下面 Python 代码执行后输出是（   ）。
    
    ```python
    for i in range(10, 100, 10):
        if i % 10 == 0:
            continue
    print(i, end="#")
    ```

{{ select(10) }}

* 90#
* 没有输出
* 10#20#30#40#50#60#70#80#90#
* 90

11. 两个正整数，只要不相等，就一直进行如下操作：最大数减去最小数得到一个值，该值和两个数的最小数构成新的两个正整数，重复操作，直到两个数相等，此时输出该数。下面的 Python 代码用于实现该操作，横线处应该填写的代码是（   ）。

    ```python
    N = int(input())
    M = int(input())
    
    while N != M:
        if N > M:
            ________________
        else:
            ________________
    
    print(N)
    ```

{{ select(11) }}

*
    ```python
    N = N - M
    M = M - N
    ```

*
    ```python
    M = M - N
    N = N - M
    ```

*
    ```python
    M = N - M
    N = M - N
    ```

*   
    ```python
    N, M = M, N
    M, N = N, M
    ```

12. 如果一个正整数能被 3 整除，或者某一位能被 3 整除，则称之为“漂亮数”。下面的 Python 程序用于判断正整数 N 是否为漂亮数，横线处应该填入的代码是（   ）。

    ```python
    N = int(input())
    
    Flag = "非漂亮数"
    if N % 3 == 0:
        Flag = "漂亮数"
    else:
        while N != 0:
            if ____________________:
                Flag = "漂亮数"
                break
            N //= 10
    print(Flag)
    ```

{{ select(12) }}

* N % 3 % 10 == 0
* N % 10 == 0
* N % 10 % 3
* N % 10 % 3 == 0

13. 下面的 Python 代码执行后海龟最终朝向是（   ）。

    ```python
    import turtle
    turtle.forward(100)
    turtle.right(90)
    turtle.forward(50)
    ```

{{ select(13) }}

* 西（180°）
* 东（0°）
* 北（90°）
* 南（270° 或 -90°)

14. 为在 Python Turtle 中输出如下图形，代码横线处应填入（   ）。

    ![image](file://14.png)

    ```python
    import turtle
    for i in range(12):
        turtle.forward(100)
        ________________
        turtle.left(30)
    ```

{{ select(14) }}

* turtle.home(0,0)
* turtle.goto(0,0)
* turtle.reset()
* turtle.home()

15. 为在 Python Turtle 中输出如下图形，代码横线处应填入（   ）。

    ![image](file://15.png)

    ```python
    import turtle
    for i in range(8):
        turtle.right(45)
        turtle.circle(50, ____________)
    ```

{{ select(15) }}

* 20 * i
* 20 * (i + 1)
* 20 * i, steps = 4
* 20 * (i + 1), steps = 4

---
