// this is the original example in nip-13 and I can't get it to work
#include <stdio.h>
int zero_bits(unsigned char b)
{
        int n = 0;

        if (b == 0)
                return 8;

        while (b >>= 1)
                n++;

        return 7-n;
}

/* find the number of leading zero bits in a hash */
int count_leading_zero_bits(unsigned char *hash)
{
        int bits, total, i;
        for (i = 0, total = 0; i < 32; i++) {
                bits = zero_bits(hash[i]);
                total += bits;
                if (bits != 8)
                        break;
        }
        return total;
}

int main() {
 int result = count_leading_zero_bits("000006d8c378af1779d2feebc7603a125d99eca0ccf1085959b307f64e5dd358");
 printf("Leadiang zeroes: %d\n", result);
 return 0;
}