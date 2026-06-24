import re, os, shutil

src = r'c:\Users\user\OneDrive\Dokumenty\GitHub\data-pipeline\main.py'
dst = r'c:\Users\user\OneDrive\Dokumenty\GitHub\data-pipeline\main.py'

with open(src, 'r') as f:
    lines = f.readlines()

# Find the main loop start
start = None
for i, line in enumerate(lines):
    if 'for _round in range(10):' in line:
        start = i
        break

# Find the end: line before "# Deduplicate notes"
end = None
for i in range(start, len(lines)):
    if '# Deduplicate notes' in lines[i]:
        end = i
        break

print(f"Replacing lines {start+1} to {end}")

new_code = '''\
    for _round in range(10):  # iterate to convergence
        changed = False

        # Clip max (per-token dynamic cap)
        surplus = 0.0
        uncapped_indices = []
        for i in range(n):
            cap_i = dynamic_caps[syms[i]]
            if pw[i] > cap_i:
                surplus += pw[i] - cap_i
                pw[i] = cap_i
                notes.append(f"{syms[i]} capped at {cap_i*100:.0f}% (vol: {volatilities.get(syms[i], 0)*100:.1f}%)")
                changed = True
            else:
                uncapped_indices.append(i)

        # Redistribute surplus proportionally to uncapped (respecting headroom)
        if surplus > 1e-8 and uncapped_indices:
            total_headroom = sum(
                max(0, dynamic_caps[syms[i]] - pw[i]) for i in uncapped_indices
            )
            if total_headroom > 1e-9:
                for i in uncapped_indices:
                    cap_i = dynamic_caps[syms[i]]
                    headroom_i = max(0, cap_i - pw[i])
                    share = surplus * (headroom_i / total_headroom)
                    pw[i] = min(pw[i] + share, cap_i)

        # Clip min
        for i in range(n):
            if 0 < pw[i] < min_weight:
                notes.append(f"{syms[i]} below {min_weight*100:.0f}% floor, removed")
                pw[i] = 0.0
                changed = True

        # Scale to max_risky: down if over, up if under with headroom
        total = sum(pw)
        if total > max_risky + 1e-9:
            scale = max_risky / total
            pw = [x * scale for x in pw]
            notes.append(f"total scaled to {max_risky*100:.0f}% risky cap")
            changed = True
        elif total < max_risky - 1e-9 and total > 1e-9:
            # Scale UP only if all tokens stay within their caps
            scale = max_risky / total
            test_pw = [x * scale for x in pw]
            if all(test_pw[i] <= dynamic_caps[syms[i]] + 1e-9 for i in range(n)):
                pw = test_pw
                notes.append(f"total scaled to {max_risky*100:.0f}% risky cap")
                changed = True

        if not changed:
            break

    # Final cap-respecting normalization
    # Scale down to max_risky if needed (never scales up -- that would breach caps)
    total = sum(pw)
    if total > max_risky + 1e-9:
        scale = max_risky / total
        pw = [x * scale for x in pw]

    # Iterative cap enforcement: clip any remaining breaches, absorb surplus
    for _final in range(20):
        any_breach = False
        surplus = 0.0
        for i in range(n):
            cap_i = dynamic_caps[syms[i]]
            if pw[i] > cap_i + 1e-9:
                surplus += pw[i] - cap_i
                pw[i] = cap_i
                any_breach = True
        if not any_breach or surplus < 1e-10:
            break
        # Redistribute surplus to tokens with headroom (proportional)
        total_headroom = sum(
            max(0, dynamic_caps[syms[i]] - pw[i]) for i in range(n)
        )
        if total_headroom > 1e-9 and surplus > 0:
            for i in range(n):
                cap_i = dynamic_caps[syms[i]]
                headroom = max(0, cap_i - pw[i])
                if headroom > 1e-9:
                    give = surplus * (headroom / total_headroom)
                    pw[i] = min(pw[i] + give, cap_i)

    # SAFETY: final scale-down if redistribution pushed total above max_risky
    total = sum(pw)
    if total > max_risky + 1e-9:
        scale = max_risky / total
        pw = [x * scale for x in pw]

'''

lines[start:end] = [new_code]

with open(dst, 'w') as f:
    f.writelines(lines)

print("Done! KKT cap enforcement rewritten.")
