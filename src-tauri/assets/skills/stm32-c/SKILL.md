---
name: stm32-c
description: Use when developing firmware for STM32 microcontrollers in C — setting up an arm-none-eabi toolchain with CMake or Makefile, working with STM32CubeMX/HAL/LL drivers, configuring linker scripts and startup files, flashing/debugging via OpenOCD/ST-Link/J-Link, handling clocks, GPIO, interrupts/NVIC, timers, UART/SPI/I2C, and DMA. Triggers on STM32, embedded C, bare-metal, HAL, CubeMX, STM32CubeCLT, STM32CubeProgrammer, arm-none-eabi, OpenOCD, ST-Link, SWO/ITM, .ld linker script, NVIC, register.
---

# STM32 Bare-metal / HAL Firmware in C

Guidance for STM32 (Cortex-M) firmware. Default to **arm-none-eabi-gcc + CMake**, STM32CubeMX-generated HAL as a starting point, **OpenOCD** for flash/debug.

**Fastest setup:** install **STM32CubeCLT** — ST's cross-platform command-line bundle that ships arm-none-eabi-gcc/gdb, CMake, Ninja, STM32CubeProgrammer (`STM32_Programmer_CLI`), the ST-LINK GDB server, and OpenOCD together, so you don't assemble the toolchain by hand. STM32CubeMX (6.10+) can generate a ready **CMake** project, not just a Makefile.

## Toolchain

- **arm-none-eabi-gcc** (Arm GNU Toolchain) — `arm-none-eabi-gcc`, `-objcopy`, `-size`, `-gdb`.
- **CMake ≥ 3.21** + Ninja, or the Makefile CubeMX emits.
- **OpenOCD** (or STM32CubeProgrammer / ST-Link CLI / J-Link) for programming.
- A board with ST-Link (e.g. Nucleo/Discovery) or a standalone ST-Link/J-Link probe.

## CMake toolchain file (cmake/arm-none-eabi.cmake)

```cmake
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER   arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY      arm-none-eabi-objcopy)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)  # don't try to link a host exe

set(MCU_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")
set(CMAKE_C_FLAGS_INIT "${MCU_FLAGS} -ffunction-sections -fdata-sections")
set(CMAKE_EXE_LINKER_FLAGS_INIT "${MCU_FLAGS} -Wl,--gc-sections -specs=nano.specs -specs=nosys.specs")
```

Configure with: `cmake --preset debug` where the preset sets `CMAKE_TOOLCHAIN_FILE` to this file and passes `-DCMAKE_BUILD_TYPE=Debug`. If you let CubeMX generate the project (6.15+), it emits `cmake/gcc-arm-none-eabi.cmake`, `CMakeLists.txt`, and `CMakePresets.json` — and selects the toolchain file in **CMakePresets**, not in `CMakeLists.txt` (a common "compiler is your host gcc" build break if you configure without the preset).

Match `-mcpu`/`-mfpu`/`-mfloat-abi` to the exact part (e.g. M0/M0+ have **no FPU** → `-mcpu=cortex-m0plus -mfloat-abi=soft`, drop `-mfpu`).

## Build essentials

A firmware target needs: your sources + HAL/CMSIS, the **startup\_\*.s** assembly, the **linker script (.ld)**, and `system_stm32xxxx.c`. Produce a binary/hex:

```cmake
add_executable(firmware.elf ${SOURCES} startup_stm32f407xx.s)
target_link_options(firmware.elf PRIVATE -T${CMAKE_SOURCE_DIR}/STM32F407VGTx_FLASH.ld)

add_custom_command(TARGET firmware.elf POST_BUILD
  COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:firmware.elf> firmware.bin
  COMMAND arm-none-eabi-size $<TARGET_FILE:firmware.elf>)
```

`arm-none-eabi-size` shows flash (`text`+`data`) and RAM (`data`+`bss`) usage — check it fits the part.

## Flash & debug with OpenOCD

```bash
# Flash an ELF/bin via ST-Link
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg \
  -c "program firmware.elf verify reset exit"

# ST-native flasher (from STM32CubeCLT/STM32CubeProgrammer) — often simpler:
STM32_Programmer_CLI -c port=SWD freq=4000 -w firmware.elf -v -rst   # add -e all to mass-erase

# Start a GDB server for debugging
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg
# then in another shell:
arm-none-eabi-gdb firmware.elf -ex "target extended-remote :3333" -ex "load"
```

## HAL vs LL vs registers

- **HAL**: portable, fast to start (CubeMX generates init). Heavier, some abstraction cost.
- **LL (Low-Layer)**: thin register wrappers — good middle ground for performance-sensitive paths.
- **Direct registers (CMSIS)**: `GPIOA->ODR |= (1<<5);` — smallest/fastest, but you own clock-enable and config. Always enable the peripheral clock first (`RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;`).

## Interrupts / NVIC

- Handler names must match the vector table in `startup_*.s` (e.g. `TIM2_IRQHandler`, `USART2_IRQHandler`).
- Enable in NVIC (`HAL_NVIC_EnableIRQ` / `NVIC_EnableIRQ`) **and** the peripheral's interrupt enable bit.
- Keep ISRs short; clear the pending flag; defer work to the main loop. Mark shared state `volatile`.

## Common pitfalls

- **Hard fault on boot** → wrong clock config, stack not in valid RAM (check `.ld`), or FPU used without enabling it; verify `SystemInit`/clock setup.
- **Code builds but won't run** → linker script / startup file don't match the part; flash origin/length wrong; vector table not at the expected address.
- **Float/`-mfpu` mismatch** → all objects + libs must share the same float ABI, or you get link errors / silent corruption.
- **Peripheral "dead"** → forgot to enable its RCC clock, or wrong AF (alternate function) mux on the GPIO.
- **OpenOCD "init mode failed" / "target not halted"** → wrong target cfg, low SWD speed needed, or board not powered/connected; try `reset halt`.
- **`-specs=nosys.specs`** stubs out syscalls — `printf` won't appear unless you retarget `_write` to UART/SWO/semihosting. SWO/ITM (`ITM_SendChar`) is the fastest path, but ITM is **absent on Cortex-M0/M0+** — use UART or OpenOCD semihosting there.
- **CubeMX project builds with the wrong (host) compiler** → you configured without the preset; on 6.15+ the toolchain file is selected in `CMakePresets.json`, so always use `cmake --preset <name>`.
- Verify by flashing to real hardware and observing behavior (LED/UART/debugger), not by reading source alone.
