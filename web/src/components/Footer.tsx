import { useTranslation } from 'react-i18next';

export default function Footer() {
    const { t } = useTranslation();
    return (
        <footer className="bg-bg p-4 text-center text-[0.85rem] text-nav [&_a]:text-white [&_i]:opacity-90">
            <div>
                {t('footer_powered_by')}{' '}
                <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/"
                >
                    zny-nomp
                </a>{' '}
                {t('footer_forked_by')}{' '}
                <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://github.com/ROZ-MOFUMOFU-ME/"
                >
                    ROZ
                </a>
                {t('footer_credits')}{' '}
                <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://en.wikipedia.org/wiki/MIT_License"
                >
                    {t('footer_mit_license')}
                </a>
                .
            </div>

            <div className="mt-2.5 break-all text-xs leading-[1.9]">
                <i className="fas fa-heart fa-fw" /> {t('footer_donating')}
                &nbsp;&nbsp;
                <i className="fab fa-bitcoin fa-fw" /> BTC:
                3FpbJ5cotwPZQn9fcdZrPv4h72XquzEvez&nbsp;&nbsp;
                <i className="fab fa-ethereum fa-fw" /> ETH:
                0xc664a0416c23b1b13a18e86cb5fdd1007be375ae&nbsp;&nbsp; LTC:
                Lh96WZ7Rw9Wf4GDX2KXpzieneZFV5Xe5ou
                <br />
                <i className="fab fa-bitcoin fa-fw" /> BCH:
                pzdsppue8uwc20x35psaqq8sgchkenr49c0qxzazxu&nbsp;&nbsp;
                <i className="fab fa-ethereum fa-fw" /> ETC:
                0xc664a0416c23b1b13a18e86cb5fdd1007be375ae&nbsp;&nbsp;
                <i className="fas fa-cat fa-fw" /> MONA:
                MLEqE3vi11j4ZguMjkvMn5rUtze6kXbAzQ
            </div>

            <div className="mt-2.5 text-xs leading-[1.9]">
                <i className="fas fa-comments fa-fw" /> {t('footer_contact')}
                &nbsp;&nbsp;
                <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://twitter.com/ROZ_mofumofu_me"
                    aria-label="X / Twitter"
                >
                    <i className="fab fa-x-twitter fa-fw" />
                </a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a
                    href="mailto:mail@mofumofu.me"
                    aria-label={t('common_email')}
                >
                    <i className="fas fa-envelope fa-fw" />
                </a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://discord.gg/zHUdQy2NzU"
                    aria-label="Discord"
                >
                    <i className="fab fa-discord fa-fw" />
                </a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <iframe
                    src="https://ghbtns.com/github-btn.html?user=ROZ-MOFUMOFU-ME&repo=zny-nomp&type=star&count=true"
                    frameBorder="0"
                    scrolling="0"
                    width="150"
                    height="20"
                    title="zny-nomp on GitHub"
                    className="ml-1 inline-block align-middle"
                />
            </div>
        </footer>
    );
}
