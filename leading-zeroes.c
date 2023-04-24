#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int countLeadingZeroes(const char *hex) {
    int count = 0;

    for (int i = 0; i < strlen(hex); i++) {
        int nibble = (int)strtol((char[]){hex[i], '\0'}, NULL, 16);
        if (nibble == 0) {
            count += 4;
        } else {
            count += __builtin_clz(nibble) - 28;
            break;
        }
    }

    return count;
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <hex_string>\n", argv[0]);
        return 1;
    }

    const char *hex_string = argv[1];
    int result = countLeadingZeroes(hex_string);
    printf("Leading zeroes in hex string %s: %d\n", hex_string, result);

    return 0;
}
